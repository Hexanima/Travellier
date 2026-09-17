import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const androidManifest = readFileSync(
  fileURLToPath(
    new URL("../../android/app/src/main/AndroidManifest.xml", import.meta.url),
  ),
  "utf8",
);
const iosInfoPlist = readFileSync(
  fileURLToPath(new URL("../../ios/App/App/Info.plist", import.meta.url)),
  "utf8",
);

describe("native deep link configuration", () => {
  it("registers the application scheme in Android", () => {
    expect(androidManifest).toMatch(
      /<intent-filter>\s*<action android:name="android\.intent\.action\.VIEW" \/>/,
    );
    expect(androidManifest).toMatch(
      /<category android:name="android\.intent\.category\.DEFAULT" \/>/,
    );
    expect(androidManifest).toMatch(
      /<category android:name="android\.intent\.category\.BROWSABLE" \/>/,
    );
    expect(androidManifest).toMatch(
      /<data android:scheme="com\.travellier\.app" \/>/,
    );
    expect(androidManifest).toMatch(/<data android:scheme="com\.tuapp" \/>/);
  });

  it("registers the application scheme in iOS", () => {
    expect(iosInfoPlist).toMatch(
      /<key>CFBundleURLTypes<\/key>[\s\S]*?<key>CFBundleURLSchemes<\/key>[\s\S]*?<string>com\.travellier\.app<\/string>/,
    );
    expect(iosInfoPlist).toMatch(
      /<key>CFBundleURLSchemes<\/key>[\s\S]*?<string>com\.tuapp<\/string>/,
    );
  });
});
