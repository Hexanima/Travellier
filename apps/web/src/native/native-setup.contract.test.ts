import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const android = read("../../android/app/src/main/AndroidManifest.xml");
const plist = read("../../ios/App/App/Info.plist");
const delegate = read("../../ios/App/App/AppDelegate.swift");
const project = read("../../ios/App/App.xcodeproj/project.pbxproj");

describe("native setup", () => {
  it("disables automatic FCM token creation before an explicit registration", () => {
    expect(android).toMatch(/android:name="firebase_messaging_auto_init_enabled"\s+android:value="false"/);
  });

  it("does not add broad photo, microphone, location or background capabilities", () => {
    expect(android).not.toMatch(/READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|READ_MEDIA_IMAGES|RECORD_AUDIO|ACCESS_FINE_LOCATION|ACCESS_BACKGROUND_LOCATION/);
    expect(plist).not.toMatch(/NSMicrophoneUsageDescription|NSLocationAlways|UIBackgroundModes|NSReminders/);
  });

  it("declares usage descriptions for camera, photos and both iOS calendar access levels", () => {
    for (const key of ["NSCameraUsageDescription", "NSPhotoLibraryUsageDescription", "NSPhotoLibraryAddUsageDescription", "NSCalendarsUsageDescription", "NSCalendarsWriteOnlyAccessUsageDescription", "NSCalendarsFullAccessUsageDescription"]) {
      expect(plist).toMatch(new RegExp(`<key>${key}</key>\\s*<string>[^<]+</string>`));
    }
  });

  it("forwards APNs registration and failure through Capacitor", () => {
    expect(delegate).toContain(".capacitorDidRegisterForRemoteNotifications");
    expect(delegate).toContain(".capacitorDidFailToRegisterForRemoteNotifications");
  });

  it("enables push signing capability for debug and release", () => {
    expect(project.match(/CODE_SIGN_ENTITLEMENTS = App\/App.entitlements;/g)).toHaveLength(2);
    expect(project).toContain("com.apple.Push");
    const entitlements = read("../../ios/App/App/App.entitlements");
    expect(entitlements).toContain("<key>aps-environment</key>");
    expect(entitlements).not.toMatch(/icloud|healthkit|associated-domains/);
  });

  it("keeps the calendar plugin surface the event adapter relies on (no id-based modify)", () => {
    const definitions = read("../../../../node_modules/@capacitor/calendar/dist/esm/definitions.d.ts");
    for (const method of ["findEvents", "createEvent", "modifyEvent", "deleteEvent"]) expect(definitions).toContain(`${method}(options`);
    expect(definitions).toMatch(/interface ModifyEventOptions \{[^}]*filter: EventFilter;[^}]*newEvent: Partial<CreateEventOptions>;/s);
    expect(definitions).not.toMatch(/interface ModifyEventOptions \{[^}]*\bid\b/s);
  });

  it("syncs every added plugin into Android and iOS SPM", () => {
    const gradle = read("../../android/app/capacitor.build.gradle");
    const spm = read("../../ios/App/CapApp-SPM/Package.swift");
    for (const name of ["camera", "push-notifications", "calendar", "filesystem", "share", "app-launcher", "keyboard"]) {
      expect(gradle).toContain(`project(':capacitor-${name}')`);
      expect(spm).toContain(`node_modules/@capacitor/${name}`);
    }
    expect(spm).toContain('exact: "8.5.2"');
  });

  it("keeps the share and filesystem options the .ics sharer uses, with the FileProvider covering the cache", () => {
    const share = read("../../../../node_modules/@capacitor/share/dist/esm/definitions.d.ts");
    expect(share).toMatch(/files\?: string\[\]/);
    expect(share).toContain("canShare(): Promise<CanShareResult>");
    const filesystem = read("../../../../node_modules/@capacitor/filesystem/dist/esm/definitions.d.ts");
    for (const name of ["Cache = \"CACHE\"", "writeFile(options", "deleteFile(options"]) expect(filesystem).toContain(name);
    expect(read("../../android/app/src/main/res/xml/file_paths.xml")).toContain("<cache-path");
    expect(android).toContain("${applicationId}.fileprovider");
  });

  it("keeps the keyboard resize surface capacitor.config.ts relies on", () => {
    const definitions = read("../../../../node_modules/@capacitor/keyboard/dist/esm/definitions.d.ts");
    expect(definitions).toMatch(/resize\?: KeyboardResize/);
    expect(definitions).toMatch(/resizeOnFullScreen\?: boolean/);
    expect(definitions).toContain('Native = "native"');
    expect(definitions).toContain("declare module '@capacitor/cli'");
  });

  it("keeps the app launcher surface the maps opener relies on", () => {
    const definitions = read("../../../../node_modules/@capacitor/app-launcher/dist/esm/definitions.d.ts");
    expect(definitions).toContain("openUrl(options");
    expect(definitions).toContain("completed: boolean");
    expect(definitions).toMatch(/interface OpenURLOptions \{\s*url: string;\s*\}/);
  });

  it("opens https maps links with the native view intent and no canOpenUrl gate, so no package visibility or url scheme queries are declared", () => {
    expect(android).not.toContain("<queries>");
    expect(plist).not.toContain("LSApplicationQueriesSchemes");
    expect(read("../../../../node_modules/@capacitor/app-launcher/android/src/main/AndroidManifest.xml")).not.toContain("uses-permission");
    const launcherAndroid = read("../../../../node_modules/@capacitor/app-launcher/android/src/main/java/com/capacitorjs/plugins/applauncher/AppLauncherPlugin.java");
    const launcherIos = read("../../../../node_modules/@capacitor/app-launcher/ios/Sources/AppLauncherPlugin/AppLauncherPlugin.swift");
    const methodBody = (source: string, signature: string) => {
      const start = source.indexOf(signature);
      const end = source.indexOf("\n    }", start);
      if (start < 0 || end < 0) throw new Error(`no se encontro el cuerpo de ${signature}`);
      return source.slice(start, end);
    };
    const androidOpenUrl = methodBody(launcherAndroid, "public void openUrl(PluginCall call)");
    expect(androidOpenUrl).toMatch(/new Intent\(\s*Intent\.ACTION_VIEW\s*\)/);
    expect(androidOpenUrl).not.toMatch(/canOpenUrl|canResolve/);
    const iosOpenUrl = methodBody(launcherIos, "func openUrl(_ call: CAPPluginCall)");
    expect(iosOpenUrl).toMatch(/UIApplication\.shared\.open\(\s*url\b/);
    expect(iosOpenUrl).not.toMatch(/canOpenURL/);
  });

  it("keeps the cancellation rejection the .ics sharer classifies as cancelled", () => {
    const androidPlugin = read("../../../../node_modules/@capacitor/share/android/src/main/java/com/capacitorjs/plugins/share/SharePlugin.java");
    expect(androidPlugin).toMatch(/RESULT_CANCELED[\s\S]{0,120}call\.reject\("Share canceled"\)/);
    const iosPlugin = read("../../../../node_modules/@capacitor/share/ios/Sources/SharePlugin/SharePlugin.swift");
    expect(iosPlugin).toContain('call.reject("Share canceled")');
  });
});
