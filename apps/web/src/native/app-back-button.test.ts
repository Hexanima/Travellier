import { describe, expect, it, vi } from "vitest";
import { createAppBackButton, type NativeBackButtonApi } from "./app-back-button.js";

const fakeNative = () => {
  let listener: (() => void) | undefined;
  const remove = vi.fn(async () => undefined);
  const exitApp = vi.fn(async () => undefined);
  const api: NativeBackButtonApi = {
    addListener: vi.fn((_event, next) => { listener = next; return Promise.resolve({ remove }); }),
    exitApp,
  };
  return { api, remove, exitApp, emit: () => listener?.() };
};

describe("app back button port", () => {
  it("avisa en cada Atrás nativo", async () => {
    const native = fakeNative();
    const pressed = vi.fn();
    createAppBackButton(native.api).onBack(pressed);
    await Promise.resolve();
    native.emit();
    native.emit();
    expect(pressed).toHaveBeenCalledTimes(2);
    expect(native.api.addListener).toHaveBeenCalledWith("backButton", expect.any(Function));
  });

  it("se desuscribe al limpiar, también si el registro nativo todavía no terminó", async () => {
    const native = fakeNative();
    const pressed = vi.fn();
    const stop = createAppBackButton(native.api).onBack(pressed);
    stop();
    await Promise.resolve(); await Promise.resolve();
    expect(native.remove).toHaveBeenCalledTimes(1);
    native.emit();
    expect(pressed).not.toHaveBeenCalled();
  });

  it("un fallo del registro nativo no rompe ni deja efectos", async () => {
    const native = fakeNative();
    const api: NativeBackButtonApi = { addListener: () => Promise.reject(new Error("sin plugin")), exitApp: native.exitApp };
    const stop = createAppBackButton(api).onBack(() => undefined);
    await Promise.resolve();
    expect(() => stop()).not.toThrow();
  });

  it("exitApp delega en el plugin nativo sin propagar el fallo", () => {
    const native = fakeNative();
    const port = createAppBackButton(native.api);
    port.exitApp();
    expect(native.exitApp).toHaveBeenCalledTimes(1);
    const failing: NativeBackButtonApi = { addListener: native.api.addListener, exitApp: () => Promise.reject(new Error("sin plugin")) };
    expect(() => createAppBackButton(failing).exitApp()).not.toThrow();
  });
});
