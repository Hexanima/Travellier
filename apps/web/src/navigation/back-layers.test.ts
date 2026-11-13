import { describe, expect, it, vi } from "vitest";
import { createBackLayerStack } from "./back-layers.js";

describe("pila de capas del Atrás", () => {
  it("sin capas no maneja nada", () => {
    expect(createBackLayerStack().handle()).toBe(false);
  });

  it("atiende la capa registrada más recientemente (LIFO)", () => {
    const stack = createBackLayerStack();
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    stack.register(first);
    stack.register(second);
    expect(stack.handle()).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("una capa que devuelve false delega en la siguiente", () => {
    const stack = createBackLayerStack();
    const first = vi.fn(() => true);
    const inactive = vi.fn(() => false);
    stack.register(first);
    stack.register(inactive);
    expect(stack.handle()).toBe(true);
    expect(inactive).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("si ninguna capa maneja el Atrás, no lo maneja la pila", () => {
    const stack = createBackLayerStack();
    stack.register(() => false);
    stack.register(() => false);
    expect(stack.handle()).toBe(false);
  });

  it("al desregistrar, la capa deja de recibir el Atrás", () => {
    const stack = createBackLayerStack();
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    stack.register(first);
    const unregister = stack.register(second);
    unregister();
    expect(stack.handle()).toBe(true);
    expect(second).not.toHaveBeenCalled();
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("desregistrar dos veces es inocuo y no saca otra capa", () => {
    const stack = createBackLayerStack();
    const first = vi.fn(() => true);
    stack.register(first);
    const unregister = stack.register(() => true);
    unregister();
    unregister();
    expect(stack.handle()).toBe(true);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("vuelve a registrar al final: una capa remontada atiende primero", () => {
    const stack = createBackLayerStack();
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    const unregister = stack.register(first);
    stack.register(second);
    unregister();
    stack.register(first);
    expect(stack.handle()).toBe(true);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });
});
