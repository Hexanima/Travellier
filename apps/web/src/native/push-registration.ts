import { NativeCapabilityError, type PushRegistrationPort } from "app-domain";
import type { PluginListenerHandle } from "@capacitor/core";
import type { NativeDependencies, NativePlatform } from "./capabilities.js";
import { nativeError, nativeResult } from "./native-result.js";

export function createPushRegistration(push: NativeDependencies["push"], platform: NativePlatform): PushRegistrationPort {
  return {
    checkPermission: () => nativeResult(platform, async () => (await push.checkPermissions()).receive),
    requestPermission: () => nativeResult(platform, async () => (await push.requestPermissions()).receive),
    register: () => nativeResult(platform, async () => {
      if ((await push.checkPermissions()).receive !== "granted") throw new NativeCapabilityError("denied");
      await push.register();
    }),
    unregister: () => nativeResult(platform, () => push.unregister()),
    listen: (handlers) => nativeResult(platform, async () => {
      const handles: PluginListenerHandle[] = [];
      let active = true;
      const remove = async () => {
        active = false;
        const results = await Promise.allSettled(handles.map((handle) => handle.remove()));
        // Retain failed removals for a subsequent cleanup attempt.
        const pending = handles.filter((_, index) => results[index].status === "rejected");
        handles.splice(0, handles.length, ...pending);
        const failure = results.find((result) => result.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
      };
      try {
        handles.push(await push.addListener("registration", ({ value }) => {
          if (!active) return;
          const name = platform();
          if (name !== "android" && name !== "ios") return;
          if (!value) { handlers.onError?.(new NativeCapabilityError("native")); return; }
          handlers.onToken?.({ token: value, provider: name === "ios" ? "apns" : "fcm", platform: name });
        }));
        handles.push(await push.addListener("registrationError", () => {
          if (active) handlers.onError?.(new NativeCapabilityError("native"));
        }));
        handles.push(await push.addListener("pushNotificationReceived", (notification) => {
          if (active) handlers.onNotification?.(notification);
        }));
        handles.push(await push.addListener("pushNotificationActionPerformed", ({ notification }) => {
          if (active) handlers.onAction?.(notification);
        }));
      } catch (error) {
        await remove().catch(() => undefined);
        throw nativeError(error);
      }
      return () => nativeResult(platform, remove);
    }),
  };
}
