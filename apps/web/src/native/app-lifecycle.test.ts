import { describe, expect, it, vi } from "vitest";
import { createAppLifecycle, type NativeAppStateApi } from "./app-lifecycle.js";

const fakeNative = () => {
  let listener: ((state: { isActive: boolean }) => void) | undefined;
  const remove = vi.fn(async () => undefined);
  const api: NativeAppStateApi = { addListener: vi.fn((_event, next) => { listener = next; return Promise.resolve({ remove }); }) };
  return { api, remove, emit: (isActive: boolean) => listener?.({ isActive }) };
};

describe("app lifecycle port", () => {
  it("avisa solo al volver a primer plano (isActive true)", async () => {
    const native = fakeNative();
    const resumed = vi.fn();
    createAppLifecycle(native.api).onResume(resumed);
    await Promise.resolve();
    native.emit(false);
    expect(resumed).not.toHaveBeenCalled();
    native.emit(true);
    expect(resumed).toHaveBeenCalledTimes(1);
    expect(native.api.addListener).toHaveBeenCalledWith("appStateChange", expect.any(Function));
  });

  it("se desuscribe al limpiar, también si el registro nativo todavía no terminó", async () => {
    const native = fakeNative();
    const resumed = vi.fn();
    const stop = createAppLifecycle(native.api).onResume(resumed);
    stop();
    await Promise.resolve(); await Promise.resolve();
    expect(native.remove).toHaveBeenCalledTimes(1);
    native.emit(true);
    expect(resumed).not.toHaveBeenCalled();
  });

  it("un fallo del registro nativo no rompe ni deja efectos", async () => {
    const api: NativeAppStateApi = { addListener: () => Promise.reject(new Error("sin plugin")) };
    const stop = createAppLifecycle(api).onResume(() => undefined);
    await Promise.resolve();
    expect(() => stop()).not.toThrow();
  });
});
