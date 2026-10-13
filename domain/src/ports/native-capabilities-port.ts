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
/** Event projection and reconciliation are implemented separately in T96. */
export interface CalendarAccessPort {
  checkAccess(): AsyncResult<CalendarAccess, NativeCapabilityError>;
  requestAccess(access: "write" | "manage"): AsyncResult<CalendarAccess, NativeCapabilityError>;
}
