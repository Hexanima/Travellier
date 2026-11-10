import type { CameraPlugin } from "@capacitor/camera";
import type { PushNotificationsPlugin } from "@capacitor/push-notifications";
import type { CalendarPlugin } from "@capacitor/calendar";
import type { CalendarAccessPort, CalendarEventsPort, ExternalLinkPort, PhotoSourcePort, PushRegistrationPort } from "app-domain";
import { createPhotoSource } from "./photo-source.js";
import { createPushRegistration } from "./push-registration.js";
import { createCalendarAccess } from "./calendar-access.js";
import { createCalendarEvents } from "./calendar-events.js";
import { createExternalLink, type ExternalLinkDependencies } from "./external-link.js";

export type NativePlatform = () => string;
export interface NativeDependencies {
  platform: NativePlatform;
  camera: Pick<CameraPlugin, "checkPermissions" | "requestPermissions" | "takePhoto" | "chooseFromGallery" | "pickImages">;
  push: Pick<PushNotificationsPlugin, "checkPermissions" | "requestPermissions" | "register" | "unregister" | "addListener">;
  calendar: Pick<CalendarPlugin, "checkPermissions" | "requestPermissions" | "findEvents" | "createEvent" | "modifyEvent" | "deleteEvent">;
  externalLink: ExternalLinkDependencies;
}
export interface NativeCapabilities {
  photos: PhotoSourcePort;
  push: PushRegistrationPort;
  calendar: CalendarAccessPort;
  calendarEvents: CalendarEventsPort;
  externalLink: ExternalLinkPort;
}
/** Construction has no permission, listener, or registration side effects. */
export function createNativeCapabilities(dependencies: NativeDependencies): NativeCapabilities {
  return {
    photos: createPhotoSource(dependencies.camera, dependencies.platform),
    push: createPushRegistration(dependencies.push, dependencies.platform),
    calendar: createCalendarAccess(dependencies.calendar, dependencies.platform),
    calendarEvents: createCalendarEvents(dependencies.calendar, dependencies.platform),
    externalLink: createExternalLink(dependencies.externalLink),
  };
}
