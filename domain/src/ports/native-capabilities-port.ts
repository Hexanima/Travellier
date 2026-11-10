import type { AsyncResult } from "../types/result.js";
import type { NativeCapabilityError } from "../errors/native-capability-error.js";

export type NativePermissionState = "prompt" | "prompt-with-rationale" | "granted" | "limited" | "denied";
export type PhotoSource = "camera" | "gallery";
export interface SelectedPhoto {
  /** Opaque local file reference; never a published photo or an S3 key. */
  reference: string;
  previewUrl?: string;
  format?: string;
}
export interface PhotoSourcePort {
  checkPermission(source: PhotoSource): AsyncResult<NativePermissionState, NativeCapabilityError>;
  select(source: PhotoSource): AsyncResult<readonly SelectedPhoto[], NativeCapabilityError>;
}
export interface NativePushToken {
  token: string;
  platform: "android" | "ios";
  provider: "fcm" | "apns";
}
export interface NativePushNotification {
  id: string;
  title?: string;
  body?: string;
  data: Readonly<Record<string, unknown>>;
}
export interface NativePushHandlers {
  onToken?: (value: NativePushToken) => void;
  onError?: (error: NativeCapabilityError) => void;
  onNotification?: (notification: NativePushNotification) => void;
  onAction?: (notification: NativePushNotification) => void;
}
export type StopNativePushListening = () => AsyncResult<void, NativeCapabilityError>;
export interface PushRegistrationPort {
  checkPermission(): AsyncResult<NativePermissionState, NativeCapabilityError>;
  requestPermission(): AsyncResult<NativePermissionState, NativeCapabilityError>;
  /** Request registration only; the token arrives through listen(). */
  register(): AsyncResult<void, NativeCapabilityError>;
  unregister(): AsyncResult<void, NativeCapabilityError>;
  listen(handlers: NativePushHandlers): AsyncResult<StopNativePushListening, NativeCapabilityError>;
}
export interface CalendarAccess {
  read: NativePermissionState;
  write: NativePermissionState;
}
export interface CalendarAccessPort {
  checkAccess(): AsyncResult<CalendarAccess, NativeCapabilityError>;
  requestAccess(access: "write" | "manage"): AsyncResult<CalendarAccess, NativeCapabilityError>;
}
/** Opens a location link outside the app (maps app or browser). Never resolves or reads the destination. */
export interface ExternalLinkPort {
  open(url: string): AsyncResult<void, NativeCapabilityError>;
}

/** Fields of a native calendar event managed by the app. `notes` carries the stable marker as its last line; times are epoch milliseconds. */
export interface CalendarEventSpec {
  title: string;
  notes: string;
  location?: string;
  url?: string;
  startDate: number;
  endDate: number;
}
/** Time range in epoch milliseconds used to search or target native events. */
export interface CalendarEventWindow {
  startMs: number;
  endMs: number;
}
export interface NativeCalendarEvent {
  id: string;
  startMs: number;
  endMs: number;
  calendarId?: string;
}
/**
 * Events of the device calendar, identified by a marker kept in their notes (the installed plugin cannot target an update by id).
 * Never requests permissions: callers check them first. Needs read and write access (find, update, remove).
 * `remove` and `update` fail with kind `missing` when no event matches.
 */
export interface CalendarEventsPort {
  find(marker: string, window: CalendarEventWindow): AsyncResult<readonly NativeCalendarEvent[], NativeCapabilityError>;
  create(spec: CalendarEventSpec): AsyncResult<{ id: string }, NativeCapabilityError>;
  update(marker: string, window: CalendarEventWindow, spec: CalendarEventSpec): AsyncResult<void, NativeCapabilityError>;
  remove(id: string): AsyncResult<void, NativeCapabilityError>;
}
