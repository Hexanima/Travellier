import { Camera } from "@capacitor/camera";
import { Calendar } from "@capacitor/calendar";
import { PushNotifications } from "@capacitor/push-notifications";
import { Capacitor } from "@capacitor/core";
import { createNativeCapabilities } from "./capabilities.js";

/** Called by integration flows; never requests permissions at startup. */
export function createCapacitorCapabilities() {
  return createNativeCapabilities({
    platform: () => Capacitor.getPlatform(),
    camera: Camera,
    push: PushNotifications,
    calendar: Calendar,
  });
}
