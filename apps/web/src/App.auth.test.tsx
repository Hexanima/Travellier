// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App.js";
import type { NativeSessionStorage } from "./auth/native-session-storage.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mountedRoots: ReturnType<typeof createRoot>[] = [];

afterEach(async () => {
  await act(async () => {
    mountedRoots.splice(0).forEach((root) => root.unmount());
  });
  document.body.replaceChildren();
});

const setValue = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const createSessionStorage = (): NativeSessionStorage => ({
  clear: vi.fn().mockResolvedValue(undefined),
  read: vi.fn().mockResolvedValue(null),
  save: vi.fn().mockResolvedValue(undefined),
});

describe("App authentication", () => {
  it("does not read stored tokens when the API is not configured", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mountedRoots.push(root);
    const sessionStorage = createSessionStorage();

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/"]}>
          <App sessionStorage={sessionStorage} />
        </MemoryRouter>,
      );
    });

    expect(sessionStorage.read).not.toHaveBeenCalled();
  });

  it("navigates to the protected area after a successful login", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mountedRoots.push(root);
    const login = vi.fn().mockResolvedValue({
      ok: true,
      value: { accessToken: "access-token", refreshToken: "refresh-token" },
    });
    const sessionStorage = createSessionStorage();

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/login"]}>
          <App auth={{ login }} sessionStorage={sessionStorage} />
        </MemoryRouter>,
      );
    });

    await setValue(container.querySelector("[name=email]") as HTMLInputElement, "nico@example.test");
    await setValue(container.querySelector("[name=password]") as HTMLInputElement, "secret-pass");
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(login).toHaveBeenCalledOnce();
    expect(sessionStorage.save).toHaveBeenCalledWith({
      accessToken: "access-token",
      refreshToken: "refresh-token",
    });
    expect(container.textContent).toContain("Acceso protegido");
  });

  it("restores and rotates the persisted session when the app opens", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mountedRoots.push(root);
    const sessionStorage = createSessionStorage();
    vi.mocked(sessionStorage.read).mockResolvedValue({
      accessToken: "persisted-access-token",
      refreshToken: "persisted-refresh-token",
    });
    const refresh = vi.fn().mockResolvedValue({
      ok: true,
      value: { accessToken: "renewed-access-token", refreshToken: "renewed-refresh-token" },
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/trips"]}>
          <App auth={{ refresh }} sessionStorage={sessionStorage} />
        </MemoryRouter>,
      );
    });

    expect(refresh).toHaveBeenCalledWith({ refreshToken: "persisted-refresh-token" });
    expect(sessionStorage.save).toHaveBeenCalledWith({
      accessToken: "renewed-access-token",
      refreshToken: "renewed-refresh-token",
    });
  });

  it("clears an invalid persisted session during restore", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mountedRoots.push(root);
    const sessionStorage = createSessionStorage();
    vi.mocked(sessionStorage.read).mockResolvedValue({
      accessToken: "expired-access-token",
      refreshToken: "invalid-refresh-token",
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/trips"]}>
          <App
            auth={{ refresh: vi.fn().mockResolvedValue({ ok: false, error: {} }) }}
            sessionStorage={sessionStorage}
          />
        </MemoryRouter>,
      );
    });

    expect(sessionStorage.clear).toHaveBeenCalledOnce();
  });

  it("clears the native session when the user logs out locally", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mountedRoots.push(root);
    const sessionStorage = createSessionStorage();

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/trips"]}>
          <App auth={{}} sessionStorage={sessionStorage} />
        </MemoryRouter>,
      );
    });

    await act(async () => {
      container.querySelector("button")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(sessionStorage.clear).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Iniciar sesión");
  });
});
