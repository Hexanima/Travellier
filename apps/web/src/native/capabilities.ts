import type { CameraPlugin } from "@capacitor/camera";
import type { PushNotificationsPlugin } from "@capacitor/push-notifications";
import type { CalendarPlugin } from "@capacitor/calendar";
import type { CalendarAccessPort, PhotoSourcePort, PushRegistrationPort } from "app-domain";
import { createPhotoSource } from "./photo-source.js";
import { createPushRegistration } from "./push-registration.js";
import { createCalendarAccess } from "./calendar-access.js";

export type NativePlatform = () => string;
export interface NativeDependencies {
  platform: NativePlatform;
  camera: Pick<CameraPlugin, "checkPermissions" | "requestPermissions" | "takePhoto" | "chooseFromGallery">;
  push: Pick<PushNotificationsPlugin, "checkPermissions" | "requestPermissions" | "register" | "unregister" | "addListener">;
  calendar: Pick<CalendarPlugin, "checkPermissions" | "requestPermissions">;
}
export interface NativeCapabilities {
  photos: PhotoSourcePort;
  push: PushRegistrationPort;
  calendar: CalendarAccessPort;
}
/** Construction has no permission, listener, or registration side effects. */
export function createNativeCapabilities(dependencies: NativeDependencies): NativeCapabilities {
  return {
    photos: createPhotoSource(dependencies.camera, dependencies.platform),
    push: createPushRegistration(dependencies.push, dependencies.platform),
    calendar: createCalendarAccess(dependencies.calendar, dependencies.platform),
  };
}
