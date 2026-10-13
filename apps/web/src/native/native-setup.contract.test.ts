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

  it("syncs all three new plugins into Android and iOS SPM", () => {
    const gradle = read("../../android/app/capacitor.build.gradle");
    const spm = read("../../ios/App/CapApp-SPM/Package.swift");
    for (const name of ["camera", "push-notifications", "calendar"]) {
      expect(gradle).toContain(`project(':capacitor-${name}')`);
      expect(spm).toContain(`node_modules/@capacitor/${name}`);
    }
    expect(spm).toContain('exact: "8.5.2"');
  });
});
