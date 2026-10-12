import { describe, expect, it, vi } from "vitest";
import { MediaType, MediaTypeSelection } from "@capacitor/camera";
import type { NativePermissionState } from "app-domain";
import { createNativeCapabilities } from "./capabilities.js";
import type { NativeDependencies } from "./capabilities.js";

function fixture(platform = "ios") {
  let permission: NativePermissionState = "prompt";
  const listeners = new Map<string, (event: never) => void>();
  const removed: string[] = [];
  const dependencies = {
    platform: () => platform,
    camera: {
      checkPermissions: vi.fn(async () => ({ camera: permission, photos: permission })),
      requestPermissions: vi.fn(async () => ({ camera: "granted" as const, photos: "limited" as const })),
      takePhoto: vi.fn(async () => ({ uri: "file://photo.jpg", webPath: "capacitor://photo.jpg", type: MediaType.Photo, saved: false, metadata: { format: "jpeg" } })),
      chooseFromGallery: vi.fn(async () => ({ results: [{ uri: "file://picked.jpg", webPath: "capacitor://picked.jpg", type: MediaType.Photo, saved: false }] })),
    },
    push: {
      checkPermissions: vi.fn(async () => ({ receive: permission })),
      requestPermissions: vi.fn(async () => ({ receive: "granted" as const })),
      register: vi.fn(async () => undefined),
      unregister: vi.fn(async () => undefined),
      addListener: vi.fn(async (name: string, callback: (event: never) => void) => {
        listeners.set(name, callback);
        return { remove: vi.fn(async () => { removed.push(name); listeners.delete(name); }) };
      }),
    },
    calendar: {
      checkPermissions: vi.fn(async () => ({ readCalendar: permission, writeCalendar: permission })),
      requestPermissions: vi.fn(async () => ({ readCalendar: "granted" as NativePermissionState, writeCalendar: "granted" as NativePermissionState })),
    },
  };
  return { dependencies: dependencies as NativeDependencies, spies: dependencies, listeners, removed,
    setPermission: (value: NativePermissionState) => { permission = value; } };
}

describe("native capabilities", () => {
  it("creates services without checking/requesting permissions or registering listeners", () => {
    const { dependencies, spies } = fixture();
    createNativeCapabilities(dependencies);
    for (const plugin of [spies.camera, spies.push, spies.calendar]) {
      expect(plugin.checkPermissions).not.toHaveBeenCalled();
      expect(plugin.requestPermissions).not.toHaveBeenCalled();
    }
    expect(spies.push.register).not.toHaveBeenCalled();
    expect(spies.push.addListener).not.toHaveBeenCalled();
  });

  it("returns unsupported in browser without invoking native APIs", async () => {
    const { dependencies, spies } = fixture("web");
    const services = createNativeCapabilities(dependencies);
    for (const result of [await services.photos.select("camera"), await services.push.requestPermission(), await services.calendar.requestAccess("manage")]) {
      expect(result).toMatchObject({ ok: false, error: { kind: "unsupported" } });
    }
    expect(spies.camera.takePhoto).not.toHaveBeenCalled();
    expect(spies.push.requestPermissions).not.toHaveBeenCalled();
    expect(spies.calendar.requestPermissions).not.toHaveBeenCalled();
  });

  it("requests only camera access on iOS before taking a photo", async () => {
    const { dependencies, spies } = fixture();
    const result = await createNativeCapabilities(dependencies).photos.select("camera");
    expect(result).toEqual({ ok: true, value: [{ reference: "file://photo.jpg", previewUrl: "capacitor://photo.jpg", format: "jpeg" }] });
    expect(spies.camera.requestPermissions).toHaveBeenCalledWith({ permissions: ["camera"] });
    expect(spies.camera.takePhoto).toHaveBeenCalledWith({ saveToGallery: false, includeMetadata: true });
    expect(spies.push.requestPermissions).not.toHaveBeenCalled();
    expect(spies.calendar.requestPermissions).not.toHaveBeenCalled();
  });

  it("uses the system photo picker without broad library permissions on Android", async () => {
    const { dependencies, spies } = fixture("android");
    const result = await createNativeCapabilities(dependencies).photos.select("gallery");
    expect(result).toMatchObject({ ok: true, value: [{ reference: "file://picked.jpg" }] });
    expect(spies.camera.requestPermissions).not.toHaveBeenCalled();
    expect(spies.camera.chooseFromGallery).toHaveBeenCalledWith({ mediaType: MediaTypeSelection.Photo, allowMultipleSelection: true, includeMetadata: true });
  });

  it("does not request library access for the iOS system picker either", async () => {
    const { dependencies, spies } = fixture();
    await createNativeCapabilities(dependencies).photos.select("gallery");
    expect(spies.camera.requestPermissions).not.toHaveBeenCalled();
  });

  it("preserves limited library access as a usable permission state", async () => {
    const { dependencies, setPermission } = fixture();
    setPermission("limited");
    expect(await createNativeCapabilities(dependencies).photos.checkPermission("gallery")).toEqual({ ok: true, value: "limited" });
  });

  it("does not retry a denied camera permission or launch the camera", async () => {
    const { dependencies, spies, setPermission } = fixture();
    setPermission("denied");
    expect(await createNativeCapabilities(dependencies).photos.select("camera")).toMatchObject({ ok: false, error: { kind: "denied" } });
    expect(spies.camera.requestPermissions).not.toHaveBeenCalled();
    expect(spies.camera.takePhoto).not.toHaveBeenCalled();
  });

  it.each([["OS-PLUG-CAMR-0006", "cancelled"], ["OS-PLUG-CAMR-0020", "cancelled"], ["OS-PLUG-CAMR-0003", "denied"], ["OS-PLUG-CAMR-0004", "native"]])("maps photo error %s to %s", async (code, kind) => {
    const { dependencies, spies } = fixture("android");
    spies.camera.takePhoto.mockRejectedValueOnce({ code, message: "native details" });
    expect(await createNativeCapabilities(dependencies).photos.select("camera")).toMatchObject({ ok: false, error: { kind } });
  });

  it("treats empty selection as cancellation", async () => {
    const { dependencies, spies } = fixture();
    spies.camera.chooseFromGallery.mockResolvedValueOnce({ results: [] });
    expect(await createNativeCapabilities(dependencies).photos.select("gallery")).toMatchObject({ ok: false, error: { kind: "cancelled" } });
  });

  it("rejects invalid media without exposing it as a photo", async () => {
    const { dependencies, spies } = fixture();
    spies.camera.takePhoto.mockResolvedValueOnce({ uri: "", webPath: "", type: MediaType.Video, saved: false, metadata: { format: "mp4" } });
    expect(await createNativeCapabilities(dependencies).photos.select("camera")).toMatchObject({ ok: false, error: { kind: "native" } });
  });

  it("requires push permission before registration without prompting implicitly", async () => {
    const { dependencies, spies } = fixture();
    expect(await createNativeCapabilities(dependencies).push.register()).toMatchObject({ ok: false, error: { kind: "denied" } });
    expect(spies.push.register).not.toHaveBeenCalled();
    expect(spies.push.requestPermissions).not.toHaveBeenCalled();
  });

  it("requests push permission explicitly without registering the device", async () => {
    const { dependencies, spies } = fixture();
    expect(await createNativeCapabilities(dependencies).push.requestPermission()).toEqual({ ok: true, value: "granted" });
    expect(spies.push.register).not.toHaveBeenCalled();
  });

  it.each([["ios", "apns"], ["android", "fcm"]])("delivers %s registration as %s and releases only owned listeners", async (platform, provider) => {
    const { dependencies, listeners, removed, setPermission } = fixture(platform);
    setPermission("granted");
    const services = createNativeCapabilities(dependencies);
    const onToken = vi.fn();
    const onError = vi.fn();
    const onNotification = vi.fn();
    const onAction = vi.fn();
    const subscription = await services.push.listen({ onToken, onError, onNotification, onAction });
    expect(subscription.ok).toBe(true);
    expect(await services.push.register()).toEqual({ ok: true, value: undefined });
    listeners.get("registration")?.({ value: "token" } as never);
    expect(onToken).toHaveBeenCalledWith({ token: "token", provider, platform });
    listeners.get("registrationError")?.({ error: "failed" } as never);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind: "native" }));
    listeners.get("pushNotificationReceived")?.({ id: "n1", data: { tripId: "trip" } } as never);
    expect(onNotification).toHaveBeenCalledWith({ id: "n1", data: { tripId: "trip" } });
    listeners.get("pushNotificationActionPerformed")?.({ notification: { id: "n1", data: {} } } as never);
    expect(onAction).toHaveBeenCalledWith({ id: "n1", data: {} });
    if (subscription.ok) {
      expect(await subscription.value()).toEqual({ ok: true, value: undefined });
      await subscription.value();
    }
    expect(removed).toHaveLength(4);
    expect(listeners.size).toBe(0);
  });

  it("cleans earlier listeners when installing a subscription fails", async () => {
    const { dependencies, spies, removed } = fixture();
    spies.push.addListener.mockImplementationOnce(async (name) => ({ remove: vi.fn(async () => { removed.push(name); }) }));
    spies.push.addListener.mockRejectedValueOnce(new Error("bridge failure"));
    expect(await createNativeCapabilities(dependencies).push.listen({})).toMatchObject({ ok: false, error: { kind: "native" } });
    expect(removed).toEqual(["registration"]);
  });

  it("reports native registration and unregistration failures", async () => {
    const { dependencies, spies, setPermission } = fixture();
    setPermission("granted");
    spies.push.register.mockRejectedValueOnce(new Error("Firebase not configured"));
    spies.push.unregister.mockRejectedValueOnce(new Error("bridge failure"));
    const services = createNativeCapabilities(dependencies);
    expect(await services.push.register()).toMatchObject({ ok: false, error: { kind: "native" } });
    expect(await services.push.unregister()).toMatchObject({ ok: false, error: { kind: "native" } });
  });

  it("checks calendar permissions without requesting them", async () => {
    const { dependencies, spies } = fixture();
    expect(await createNativeCapabilities(dependencies).calendar.checkAccess()).toEqual({ ok: true, value: { read: "prompt", write: "prompt" } });
    expect(spies.calendar.requestPermissions).not.toHaveBeenCalled();
  });

  it.each([["write", ["writeCalendar"]], ["manage", ["readCalendar", "writeCalendar"]]])("requests explicit %s calendar access", async (access, permissions) => {
    const { dependencies, spies } = fixture();
    expect(await createNativeCapabilities(dependencies).calendar.requestAccess(access as "write" | "manage")).toEqual({ ok: true, value: { read: "granted", write: "granted" } });
    expect(spies.calendar.requestPermissions).toHaveBeenCalledWith({ permissions });
    expect(spies.push.requestPermissions).not.toHaveBeenCalled();
    expect(spies.camera.requestPermissions).not.toHaveBeenCalled();
  });

  it("returns denied calendar status without claiming synchronization", async () => {
    const { dependencies, spies } = fixture();
    spies.calendar.requestPermissions.mockResolvedValueOnce({ readCalendar: "denied", writeCalendar: "denied" });
    expect(await createNativeCapabilities(dependencies).calendar.requestAccess("manage")).toEqual({ ok: true, value: { read: "denied", write: "denied" } });
  });

  it("maps calendar bridge exceptions into Result", async () => {
    const { dependencies, spies } = fixture();
    spies.calendar.checkPermissions.mockRejectedValueOnce(new Error("bridge failure"));
    expect(await createNativeCapabilities(dependencies).calendar.checkAccess()).toMatchObject({ ok: false, error: { kind: "native" } });
  });
});
