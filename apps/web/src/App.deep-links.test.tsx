// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App.js";
import type { NativeSessionStorage } from "./auth/native-session-storage.js";
import type { NativeAppUrlApi } from "./navigation/app-url-listener.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: ReturnType<typeof createRoot>[] = [];

afterEach(async () => {
  await act(async () => {
    mountedRoots.splice(0).forEach((root) => root.unmount());
  });
  document.body.replaceChildren();
});

const createStorage = (): NativeSessionStorage => ({
  read: vi.fn().mockResolvedValue(null),
  save: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
});

function createNativeApp(launchUrl?: string) {
  let emit: (event: { url: string }) => void = () => undefined;
  const nativeApp: NativeAppUrlApi = {
    addListener: vi.fn(async (_eventName, listener) => {
      emit = listener;
      return { remove: vi.fn().mockResolvedValue(undefined) };
    }),
    getLaunchUrl: vi.fn().mockResolvedValue(launchUrl ? { url: launchUrl } : undefined),
  };
  return { nativeApp, emit: (url: string) => emit({ url }) };
}

function CurrentPath() {
  const location = useLocation();
  return <output data-testid="path">{location.pathname}{location.search}</output>;
}

async function renderApp(nativeApp: NativeAppUrlApi, sessionStorage = createStorage(), auth: Record<string, unknown> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/"]}>
        <App auth={auth} sessionStorage={sessionStorage} nativeApp={nativeApp} />
        <CurrentPath />
      </MemoryRouter>,
    );
  });
  return container;
}

describe("App deep links", () => {
  it("opens the invitation entry with the original code on cold launch", async () => {
    const { nativeApp } = createNativeApp("com.travellier.app://invite/VIAJE-X7K2?source=share");
    const container = await renderApp(nativeApp);

    expect(container.textContent).toContain("Unirse a un viaje");
    expect(container.textContent).toContain("VIAJE-X7K2");
    expect(container.querySelector("[data-testid=path]")?.textContent).toBe("/invite/VIAJE-X7K2?source=share");
  });

  it("opens the verification screen when the running app receives a link", async () => {
    const { nativeApp, emit } = createNativeApp();
    const container = await renderApp(nativeApp);

    await act(async () => emit("com.travellier.app://verify/token-123"));

    expect(container.textContent).toContain("Verificación de email");
    expect(container.querySelector("[data-testid=path]")?.textContent).toBe("/verify/token-123");
    expect(container.textContent).not.toContain("Página no encontrada");
  });

  it("returns to the invitation after login", async () => {
    const { nativeApp } = createNativeApp("com.travellier.app://invite/VIAJE-X7K2");
    const login = vi.fn().mockResolvedValue({ ok: true, value: { accessToken: "access", refreshToken: "refresh" } });
    const container = await renderApp(nativeApp, createStorage(), { login });

    await act(async () => container.querySelector('a[href="/login"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    await act(async () => {
      const email = container.querySelector("[name=email]") as HTMLInputElement;
      const password = container.querySelector("[name=password]") as HTMLInputElement;
      email.value = "nico@example.test";
      email.dispatchEvent(new Event("input", { bubbles: true }));
      password.value = "secret-pass";
      password.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(login).toHaveBeenCalledOnce();
    expect(container.querySelector("[data-testid=path]")?.textContent).toBe("/invite/VIAJE-X7K2");
    expect(container.textContent).toContain("Unirse a un viaje");
  });

  it("keeps the invitation while switching between login and registration", async () => {
    const { nativeApp } = createNativeApp("com.travellier.app://invite/VIAJE-X7K2");
    const login = vi.fn().mockResolvedValue({ ok: true, value: { accessToken: "access", refreshToken: "refresh" } });
    const container = await renderApp(nativeApp, createStorage(), { login });

    for (const href of ["/login", "/register", "/login"]) {
      await act(async () => container.querySelector(`a[href="${href}"]`)?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    }
    await act(async () => {
      const email = container.querySelector("[name=email]") as HTMLInputElement;
      const password = container.querySelector("[name=password]") as HTMLInputElement;
      email.value = "nico@example.test";
      email.dispatchEvent(new Event("input", { bubbles: true }));
      password.value = "secret-pass";
      password.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(login).toHaveBeenCalledOnce();
    expect(container.querySelector("[data-testid=path]")?.textContent).toBe("/invite/VIAJE-X7K2");
  });

  it("keeps a cold-launch invitation when session restoration finishes later", async () => {
    const storage = createStorage();
    vi.mocked(storage.read).mockResolvedValue({ accessToken: "old", refreshToken: "refresh" });
    let finishRefresh: (value: unknown) => void = () => undefined;
    const refresh = vi.fn(() => new Promise((resolve) => { finishRefresh = resolve; }));
    const { nativeApp } = createNativeApp("com.travellier.app://invite/VIAJE-X7K2");
    const container = await renderApp(nativeApp, storage, { refresh });

    await act(async () => finishRefresh({ ok: true, value: { accessToken: "new", refreshToken: "new-refresh" } }));

    expect(container.querySelector("[data-testid=path]")?.textContent).toBe("/invite/VIAJE-X7K2");
  });
});
