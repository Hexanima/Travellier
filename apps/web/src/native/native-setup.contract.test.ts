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

  it("syncs all three new plugins into Android and iOS SPM", () => {
    const gradle = read("../../android/app/capacitor.build.gradle");
    const spm = read("../../ios/App/CapApp-SPM/Package.swift");
    for (const name of ["camera", "push-notifications", "calendar", "filesystem", "share"]) {
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
});
