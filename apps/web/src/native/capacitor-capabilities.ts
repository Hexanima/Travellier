import { Camera } from "@capacitor/camera";
import { Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { AppLauncher } from "@capacitor/app-launcher";
import { Calendar } from "@capacitor/calendar";
import { PushNotifications } from "@capacitor/push-notifications";
import { Capacitor } from "@capacitor/core";
import { downloadIcs } from "../calendar/download-ics.js";
import { createNativeCapabilities } from "./capabilities.js";
import { createNativeIcsSharer } from "./ics-share.js";

/** Called by integration flows; never requests permissions at startup. */
export function createCapacitorCapabilities() {
  return createNativeCapabilities({
    platform: () => Capacitor.getPlatform(),
    camera: Camera,
    push: PushNotifications,
    calendar: Calendar,
    externalLink: { launcher: AppLauncher, open: (url, target, features) => window.open(url, target, features) },
  });
}

/** Saves and shares the `.ics` through the device share sheet; on other platforms it falls back to the Blob download. No plugin call at creation. */
export function createCapacitorIcsSharer() {
  return createNativeIcsSharer({ filesystem: Filesystem, share: Share, platform: () => Capacitor.getPlatform(), fallback: (text, fileName) => downloadIcs(text, fileName) });
}
