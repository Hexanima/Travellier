// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: unknown) => void;
const native = vi.hoisted(() => ({
  listeners: {} as Record<string, (event: unknown) => void>,
  camera: { requestPermissions: vi.fn(), checkPermissions: vi.fn(), takePhoto: vi.fn(), chooseFromGallery: vi.fn(), pickImages: vi.fn() },
  push: { requestPermissions: vi.fn(), checkPermissions: vi.fn(), register: vi.fn(), unregister: vi.fn(), addListener: vi.fn() },
  calendar: { requestPermissions: vi.fn(), checkPermissions: vi.fn() },
}));
vi.mock("@capacitor/camera", () => ({ Camera: native.camera }));
vi.mock("@capacitor/push-notifications", () => ({ PushNotifications: native.push }));
vi.mock("@capacitor/calendar", () => ({ Calendar: native.calendar }));
vi.mock("@capacitor/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@capacitor/core")>();
  return { ...original, Capacitor: { ...original.Capacitor, isNativePlatform: () => true, getPlatform: () => "android" } };
});

import App from "./App.js";
import type { NativeSessionStorage } from "./auth/native-session-storage.js";
import type { NativeAppUrlApi } from "./navigation/app-url-listener.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TOKEN_A = "fake-token-SENTINEL-AAAA1111";
const TOKEN_B = "fake-token-SENTINEL-BBBB2222";
const roots: ReturnType<typeof createRoot>[] = [];
let events: string[] = [];
type Call = { url: string; method: string; authorization: string | undefined; body: unknown };
let calls: Call[] = [];
let revokeBehavior: "ok" | "fail" | "hang" | "late401" = "ok";
let releaseLate401: () => void = () => undefined;

const sessions: Record<string, { accessToken: string; refreshToken: string }> = {
  "r-A": { accessToken: "access-A", refreshToken: "r-A" },
  "r-B": { accessToken: "access-B", refreshToken: "r-B" },
  "a@example.test": { accessToken: "access-A", refreshToken: "r-A" },
  "b@example.test": { accessToken: "access-B", refreshToken: "r-B" },
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let tripsStatus = 200;
let unauthorizedProfile = false;
const fakeFetch = vi.fn(async (url: string, init: RequestInit) => {
  const path = new URL(url).pathname;
  const method = init.method ?? "GET";
  const headers = (init.headers ?? {}) as Record<string, string>;
  const body = typeof init.body === "string" ? JSON.parse(init.body) as Record<string, string> : undefined;
  calls.push({ url, method, authorization: headers.Authorization, body });
  if (path === "/auth/refresh") return json(sessions[body?.refreshToken ?? ""]);
  if (path === "/auth/login") return json(sessions[body?.email ?? ""]);
  if (path === "/trips") return tripsStatus === 200 ? json({ trips: [] }) : json({ error: { code: "Unauthorized", message: "x" } }, tripsStatus);
  if (path === "/profile") return unauthorizedProfile ? json({ error: { code: "Unauthorized", message: "x" } }, 401) : json({ profile: { name: "Nico", email: "a@example.test", avatar: null } });
  if (path === "/push-devices") return json({ device: { id: "a".repeat(24), provider: "fcm", platform: "android", tokenHint: `****${body?.token.slice(-4)}`, registeredAt: "2026-11-10T10:00:00.000Z" } });
  if (path === "/push-devices/revoke") {
    events.push(`revoke:${headers.Authorization}`);
    if (revokeBehavior === "fail") throw new Error("offline");
    if (revokeBehavior === "hang") return new Promise<Response>(() => undefined);
    if (revokeBehavior === "late401") return new Promise<Response>((resolve) => { releaseLate401 = () => resolve(json({ error: { code: "Unauthorized", message: "x" } }, 401)); });
    return new Response(null, { status: 204 });
  }
  return json({}, 404);
});

const createStorage = (session: string | null): NativeSessionStorage => ({
  read: vi.fn().mockResolvedValue(session ? { accessToken: "stale", refreshToken: session } : null),
  save: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn(async () => { events.push("storage.clear"); }),
});
const launch = (hang = false) => {
  const nativeApp: NativeAppUrlApi = {
    addListener: vi.fn(async () => ({ remove: vi.fn().mockResolvedValue(undefined) })),
    getLaunchUrl: vi.fn(() => hang ? new Promise<undefined>(() => undefined) : Promise.resolve(undefined)),
  };
  return nativeApp;
};
function CurrentPath() { return <output data-testid="path">{useLocation().pathname}</output>; }
const render = async (storage: NativeSessionStorage, path = "/trips", nativeApp = launch(), noticePort?: ComponentProps<typeof App>["noticePort"]) => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(
    <MemoryRouter initialEntries={[path]}><App apiBaseUrl="https://api.test" sessionStorage={storage} nativeApp={nativeApp} noticePort={noticePort} /><CurrentPath /></MemoryRouter>,
  ));
  return container;
};
const pathOf = (container: HTMLElement) => container.querySelector("[data-testid=path]")?.textContent;
const logout = async (container: HTMLElement) => {
  const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Cerrar sesión");
  expect(button).toBeDefined();
  await act(async () => { button!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
};
const emitToken = async (value: string) => { await act(async () => native.listeners.registration?.({ value })); };
const put = () => calls.filter((call) => call.url.endsWith("/push-devices") && call.method === "PUT");
const revokes = () => calls.filter((call) => call.url.endsWith("/push-devices/revoke"));
const permission = (receive: string) => native.push.checkPermissions.mockResolvedValue({ receive });

beforeEach(() => {
  events = []; calls = []; revokeBehavior = "ok"; tripsStatus = 200; unauthorizedProfile = false;
  for (const key of Object.keys(native.listeners)) delete native.listeners[key];
  for (const plugin of [native.push, native.camera, native.calendar]) for (const fn of Object.values(plugin)) fn.mockReset();
  native.push.requestPermissions.mockResolvedValue({ receive: "granted" });
  native.push.register.mockResolvedValue(undefined);
  native.push.unregister.mockResolvedValue(undefined);
  native.push.addListener.mockImplementation(async (name: string, handler: Handler) => { native.listeners[name] = handler; return { remove: vi.fn().mockResolvedValue(undefined) }; });
  permission("prompt");
  fakeFetch.mockClear();
  vi.stubGlobal("fetch", fakeFetch);
});
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("App push registration wiring (Capacitor native, mocked plugin)", () => {
  it("never asks for the permission when mounting, restoring or signing in with an undecided permission", async () => {
    // T93: the notice opener gets a fake port, so the real push plugin is touched only by the registration service: it must not listen on mount.
    const noticePort = { listen: vi.fn(async () => ({ ok: true as const, value: async () => ({ ok: true as const, value: undefined }) })) };
    await render(createStorage(null), "/login", launch(), noticePort);
    await render(createStorage("r-A"), "/trips", launch(), noticePort);
    expect(noticePort.listen).toHaveBeenCalled();
    expect(native.push.requestPermissions).not.toHaveBeenCalled();
    expect(native.push.register).not.toHaveBeenCalled();
    expect(native.push.addListener).not.toHaveBeenCalled();
    expect(put()).toHaveLength(0);
  });

  it("with the permission granted, resume runs after restoring the session and registers with that session", async () => {
    permission("granted");
    await render(createStorage("r-A"));
    expect(native.push.requestPermissions).not.toHaveBeenCalled();
    expect(native.push.register).toHaveBeenCalledTimes(1);
    await emitToken(TOKEN_A);
    expect(put()).toHaveLength(1);
    expect(put()[0]).toMatchObject({ authorization: "Bearer access-A", body: { provider: "fcm", platform: "android", token: TOKEN_A } });
  });

  it("with the permission granted, resume also runs after signing in", async () => {
    permission("granted");
    const container = await render(createStorage(null), "/login");
    expect(native.push.register).not.toHaveBeenCalled();
    await act(async () => {
      const email = container.querySelector("[name=email]") as HTMLInputElement;
      email.value = "a@example.test";
      email.dispatchEvent(new Event("input", { bubbles: true }));
      (container.querySelector("[name=password]") as HTMLInputElement).value = "secret-pass";
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(pathOf(container)).toBe("/trips");
    expect(native.push.register).toHaveBeenCalledTimes(1);
    await emitToken(TOKEN_A);
    expect(put()[0]).toMatchObject({ authorization: "Bearer access-A" });
  });

  it("logout revokes with the outgoing bearer before clearing the storage and the session", async () => {
    permission("granted");
    const storage = createStorage("r-A");
    const container = await render(storage);
    await emitToken(TOKEN_A);
    await logout(container);
    expect(events).toEqual(["revoke:Bearer access-A", "storage.clear"]);
    expect(revokes()[0]).toMatchObject({ body: { provider: "fcm", token: TOKEN_A } });
    expect(revokes()[0].url).not.toContain(TOKEN_A);
    expect(native.push.unregister).toHaveBeenCalledTimes(1);
    expect(pathOf(container)).toBe("/login");
  });

  it("logout still clears and navigates to /login when the revocation fails", async () => {
    permission("granted");
    revokeBehavior = "fail";
    const container = await render(createStorage("r-A"));
    await emitToken(TOKEN_A);
    await logout(container);
    expect(events).toContain("storage.clear");
    expect(pathOf(container)).toBe("/login");
  });

  it("logout still clears and navigates to /login when the revocation hangs, after 3 s", async () => {
    permission("granted");
    const container = await render(createStorage("r-A"));
    await emitToken(TOKEN_A);
    revokeBehavior = "hang";
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await logout(container);
    expect(events).not.toContain("storage.clear");
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(events).toEqual(["revoke:Bearer access-A", "storage.clear"]);
    expect(pathOf(container)).toBe("/login");
  });

  it("logout without any push registration does not call the revoke endpoint", async () => {
    const container = await render(createStorage("r-A"));
    await logout(container);
    expect(revokes()).toHaveLength(0);
    expect(native.push.unregister).not.toHaveBeenCalled();
    expect(pathOf(container)).toBe("/login");
  });

  it("switching account A to B revokes A with the bearer of A and registers B with the bearer of B", async () => {
    permission("granted");
    // The launch check never ends, so the session redirect does not leave the login form.
    const container = await render(createStorage("r-A"), "/login", launch(true));
    const staleRegistration = native.listeners.registration;
    await emitToken(TOKEN_A);
    expect(put()).toHaveLength(1);
    await act(async () => {
      (container.querySelector("[name=email]") as HTMLInputElement).value = "b@example.test";
      (container.querySelector("[name=password]") as HTMLInputElement).value = "secret-pass";
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(revokes()).toHaveLength(1);
    expect(revokes()[0]).toMatchObject({ authorization: "Bearer access-A", body: { token: TOKEN_A } });
    expect(native.push.register).toHaveBeenCalledTimes(2);
    await act(async () => staleRegistration?.({ value: TOKEN_A }));
    await emitToken(TOKEN_B);
    const puts = put();
    expect(puts).toHaveLength(2);
    expect(puts[1]).toMatchObject({ authorization: "Bearer access-B", body: { token: TOKEN_B } });
    expect(puts.filter((call) => call.authorization === "Bearer access-B").every((call) => (call.body as { token: string }).token !== TOKEN_A)).toBe(true);
    expect(calls.indexOf(revokes()[0])).toBeLessThan(calls.indexOf(puts[1]));
  });

  it("a late 401 of the outgoing session's revoke does not close the new session nor reset its push registration", async () => {
    permission("granted");
    const container = await render(createStorage("r-A"), "/login", launch(true));
    await emitToken(TOKEN_A);
    revokeBehavior = "late401";
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await act(async () => {
      (container.querySelector("[name=email]") as HTMLInputElement).value = "b@example.test";
      (container.querySelector("[name=password]") as HTMLInputElement).value = "secret-pass";
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(pathOf(container)).toBe("/trips");
    await emitToken(TOKEN_B);
    expect(put().at(-1)).toMatchObject({ authorization: "Bearer access-B", body: { token: TOKEN_B } });
    const unregisters = native.push.unregister.mock.calls.length;
    await act(async () => { releaseLate401(); await vi.advanceTimersByTimeAsync(0); });
    expect(pathOf(container)).toBe("/trips");
    expect(native.push.unregister).toHaveBeenCalledTimes(unregisters);
    expect(container.querySelector("a[href=\"/profile\"]")).not.toBeNull();
    // B is still authenticated: the next request carries its bearer and does not end the session.
    await act(async () => { container.querySelector("a[href=\"/profile\"]")?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(pathOf(container)).toBe("/profile");
    expect(calls.filter((call) => call.url.endsWith("/profile")).at(-1)?.authorization).toBe("Bearer access-B");
  });

  it("a 401 resets locally without revoking", async () => {
    permission("granted");
    const container = await render(createStorage("r-A"));
    await emitToken(TOKEN_A);
    expect(put()).toHaveLength(1);
    unauthorizedProfile = true;
    await act(async () => { container.querySelector("a[href=\"/profile\"]")?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(pathOf(container)).toBe("/login");
    // No authenticated revoke is attempted; the plugin is unregistered locally.
    expect(revokes()).toHaveLength(0);
    expect(native.push.unregister).toHaveBeenCalledTimes(1);
  });
});
