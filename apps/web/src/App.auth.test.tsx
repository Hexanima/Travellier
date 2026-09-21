// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const httpClient = vi.hoisted(() => ({
  getAccessToken: undefined as undefined | (() => Promise<string | null>),
  post: vi.fn(),
}));

vi.mock("./api/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api/index.js")>();

  return {
    ...original,
    createHttpClient: vi.fn((dependencies) => {
      httpClient.getAccessToken = dependencies.getAccessToken;
      return { post: httpClient.post };
    }),
  };
});

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
  httpClient.getAccessToken = undefined;
  httpClient.post.mockReset();
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

  it("navigates from the public route after restoring a session", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mountedRoots.push(root);
    const sessionStorage = createSessionStorage();
    vi.mocked(sessionStorage.read).mockResolvedValue({
      accessToken: "persisted-access-token",
      refreshToken: "persisted-refresh-token",
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/"]}>
          <App
            auth={{
              refresh: vi.fn().mockResolvedValue({
                ok: true,
                value: { accessToken: "renewed-access-token", refreshToken: "renewed-refresh-token" },
              }),
            }}
            sessionStorage={sessionStorage}
          />
        </MemoryRouter>,
      );
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
            auth={{ refresh: vi.fn().mockResolvedValue({ ok: false, error: { kind: "unauthorized" } }) }}
            sessionStorage={sessionStorage}
          />
        </MemoryRouter>,
      );
    });

    expect(sessionStorage.clear).toHaveBeenCalledOnce();
  });

  it("preserves persisted tokens when refresh fails transiently", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mountedRoots.push(root);
    const sessionStorage = createSessionStorage();
    vi.mocked(sessionStorage.read).mockResolvedValue({
      accessToken: "expired-access-token",
      refreshToken: "valid-refresh-token",
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/trips"]}>
          <App
            auth={{ refresh: vi.fn().mockResolvedValue({ ok: false, error: { kind: "network" } }) }}
            sessionStorage={sessionStorage}
          />
        </MemoryRouter>,
      );
    });

    expect(sessionStorage.clear).not.toHaveBeenCalled();
  });

  it("restores the persisted access token in memory when refresh fails transiently", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mountedRoots.push(root);
    const sessionStorage = createSessionStorage();
    vi.mocked(sessionStorage.read).mockResolvedValue({
      accessToken: "persisted-access-token",
      refreshToken: "valid-refresh-token",
    });
    httpClient.post.mockResolvedValue({ ok: false, error: { kind: "network" } });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/trips"]}>
          <App apiBaseUrl="https://api.example.test" sessionStorage={sessionStorage} />
        </MemoryRouter>,
      );
    });

    if (httpClient.getAccessToken === undefined) {
      throw new Error("HTTP client was not created");
    }

    await expect(httpClient.getAccessToken()).resolves.toBe("persisted-access-token");
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

  it("does not persist a restored session after local logout", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mountedRoots.push(root);
    const sessionStorage = createSessionStorage();
    vi.mocked(sessionStorage.read).mockResolvedValue({
      accessToken: "persisted-access-token",
      refreshToken: "persisted-refresh-token",
    });
    let resolveRefresh: (value: {
      ok: true;
      value: { accessToken: string; refreshToken: string };
    }) => void;
    const refresh = vi.fn(
      () => new Promise<typeof resolveRefresh extends (value: infer TValue) => void ? TValue : never>((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/trips"]}>
          <App auth={{ refresh }} sessionStorage={sessionStorage} />
        </MemoryRouter>,
      );
    });

    await act(async () => {
      container.querySelector("button")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await act(async () => {
      resolveRefresh({
        ok: true,
        value: { accessToken: "renewed-access-token", refreshToken: "renewed-refresh-token" },
      });
    });

    expect(sessionStorage.clear).toHaveBeenCalledOnce();
    expect(sessionStorage.save).not.toHaveBeenCalled();
  });

  it("clears the session after a pending restore save resolves following logout", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mountedRoots.push(root);
    const sessionStorage = createSessionStorage();
    vi.mocked(sessionStorage.read).mockResolvedValue({
      accessToken: "persisted-access-token",
      refreshToken: "persisted-refresh-token",
    });
    let persisted = false;
    let resolveSave: () => void = () => {
      throw new Error("Restore save did not start");
    };
    vi.mocked(sessionStorage.save).mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveSave = () => {
          persisted = true;
          resolve();
        };
      }),
    );
    vi.mocked(sessionStorage.clear).mockImplementation(async () => {
      persisted = false;
    });
    let resolveRefresh: (value: {
      ok: true;
      value: { accessToken: string; refreshToken: string };
    }) => void = () => {
      throw new Error("Refresh did not start");
    };
    const refresh = vi.fn(
      () => new Promise<typeof resolveRefresh extends (value: infer TValue) => void ? TValue : never>((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/trips"]}>
          <App auth={{ refresh }} sessionStorage={sessionStorage} />
        </MemoryRouter>,
      );
    });
    await act(async () => {
      resolveRefresh({
        ok: true,
        value: { accessToken: "renewed-access-token", refreshToken: "renewed-refresh-token" },
      });
    });

    await act(async () => {
      container.querySelector("button")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await act(async () => {
      resolveSave();
    });

    expect(persisted).toBe(false);
  });
});
