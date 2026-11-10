import { NativeCapabilityError, err, ok, type NativePermissionState, type NativePushHandlers, type NativePushToken, type PushRegistrationPort, type StopNativePushListening } from "app-domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PushDeviceApi } from "./push-device-api.js";
import { createPushDeviceService, type PushDeviceService } from "./push-device-service.js";

const A: NativePushToken = { token: "fake-token-SENTINEL-AAAA1111", platform: "android", provider: "fcm" };
const B: NativePushToken = { token: "fake-token-SENTINEL-BBBB2222", platform: "android", provider: "fcm" };
const flush = () => vi.advanceTimersByTimeAsync(0);
const record = (tokenHint: string) => ({ ok: true as const, value: { id: "a".repeat(24), tokenHint, registeredAt: "2026-11-10T10:00:00.000Z" } });

const setup = (permission: NativePermissionState = "granted", requested: NativePermissionState = "granted") => {
  let handlers: NativePushHandlers = {};
  const stop = vi.fn<() => Promise<Awaited<ReturnType<StopNativePushListening>>>>(async () => ok(undefined));
  const port = {
    checkPermission: vi.fn<PushRegistrationPort["checkPermission"]>(async () => ok(permission)),
    requestPermission: vi.fn(async () => ok(requested)),
    register: vi.fn<PushRegistrationPort["register"]>(async () => ok(undefined)),
    unregister: vi.fn(async () => ok(undefined)),
    listen: vi.fn<PushRegistrationPort["listen"]>(async (value: NativePushHandlers) => { handlers = value; return ok(stop); }),
  } satisfies PushRegistrationPort;
  const api = {
    register: vi.fn(async (input: { token: string }) => record(`****${input.token.slice(-4)}`)),
    revoke: vi.fn(async () => ({ ok: true as const, value: undefined })),
  } satisfies PushDeviceApi;
  const service = createPushDeviceService({ port, api });
  return { port, api, stop, service, emit: (token: NativePushToken) => handlers.onToken?.(token), fail: () => handlers.onError?.(new NativeCapabilityError("native")) };
};
const state = (service: PushDeviceService) => service.getStatus().state;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("push device service: construction and silent checks", () => {
  it("has no effects when built and exposes no token", () => {
    const { port, api, service } = setup();
    expect(port.checkPermission).not.toHaveBeenCalled();
    expect(port.listen).not.toHaveBeenCalled();
    expect(api.register).not.toHaveBeenCalled();
    expect(JSON.stringify(service.getStatus())).not.toContain("SENTINEL");
  });
  it("refreshStatus only checks the permission and never prompts", async () => {
    for (const [permission, expected] of [["prompt", "off"], ["prompt-with-rationale", "off"], ["denied", "denied"]] as const) {
      const { port, service } = setup(permission);
      await service.refreshStatus();
      expect(state(service)).toBe(expected);
      expect(port.requestPermission).not.toHaveBeenCalled();
      expect(port.register).not.toHaveBeenCalled();
      expect(port.listen).not.toHaveBeenCalled();
    }
  });
  it("reports unsupported when the platform cannot do push", async () => {
    const { port, service } = setup();
    port.checkPermission.mockResolvedValueOnce(err(new NativeCapabilityError("unsupported")));
    await service.refreshStatus();
    expect(state(service)).toBe("unsupported");
  });
  it("notifies subscribers and stops after unsubscribing", async () => {
    const { service } = setup("denied");
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);
    await service.refreshStatus();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    await service.enable();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("push device service: resume (session start, no prompts)", () => {
  it.each(["prompt", "prompt-with-rationale", "denied"] as const)("does nothing with %s", async (permission) => {
    const { port, api, service } = setup(permission);
    await service.resume();
    expect(port.requestPermission).not.toHaveBeenCalled();
    expect(port.listen).not.toHaveBeenCalled();
    expect(port.register).not.toHaveBeenCalled();
    expect(api.register).not.toHaveBeenCalled();
  });
  it("with granted installs the listener, then registers, and the token is sent with PUT", async () => {
    const { port, api, service, emit } = setup();
    await service.resume();
    expect(port.listen.mock.invocationCallOrder[0]).toBeLessThan(port.register.mock.invocationCallOrder[0]);
    expect(state(service)).toBe("registering");
    emit(A);
    await flush();
    expect(api.register).toHaveBeenCalledWith({ provider: "fcm", platform: "android", token: A.token });
    expect(service.getStatus()).toEqual({ state: "registered", tokenHint: "****1111" });
    expect(JSON.stringify(service.getStatus())).not.toContain(A.token);
  });
  it("is idempotent while already registering or registered", async () => {
    const { port, service, emit } = setup();
    await Promise.all([service.resume(), service.resume()]);
    emit(A);
    await flush();
    await service.resume();
    expect(port.listen).toHaveBeenCalledTimes(1);
    expect(port.register).toHaveBeenCalledTimes(1);
  });
});

describe("push device service: enable (explicit user action)", () => {
  it("with prompt requests the permission once and registers when granted", async () => {
    const { port, api, service, emit } = setup("prompt", "granted");
    await service.enable();
    expect(port.requestPermission).toHaveBeenCalledTimes(1);
    expect(port.register).toHaveBeenCalledTimes(1);
    emit(A);
    await flush();
    expect(state(service)).toBe("registered");
    expect(api.register).toHaveBeenCalledTimes(1);
  });
  it("shows requesting while the dialog is open", async () => {
    const { port, service } = setup("prompt");
    let release: (value: ReturnType<typeof ok<NativePermissionState>>) => void = () => undefined;
    port.requestPermission.mockImplementationOnce(() => new Promise((resolve) => { release = resolve as typeof release; }));
    const pending = service.enable();
    await flush();
    expect(state(service)).toBe("requesting");
    release(ok("granted"));
    await pending;
    expect(state(service)).toBe("registering");
  });
  it("answers denied in the dialog without register or PUT", async () => {
    const { port, api, service } = setup("prompt", "denied");
    await service.enable();
    expect(state(service)).toBe("denied");
    expect(port.register).not.toHaveBeenCalled();
    expect(api.register).not.toHaveBeenCalled();
  });
  it("with a previous denial does not ask again", async () => {
    const { port, service } = setup("denied");
    await service.enable();
    expect(state(service)).toBe("denied");
    expect(port.requestPermission).not.toHaveBeenCalled();
    expect(port.register).not.toHaveBeenCalled();
  });
  it("with granted skips the dialog", async () => {
    const { port, service } = setup("granted");
    await service.enable();
    expect(port.requestPermission).not.toHaveBeenCalled();
    expect(port.register).toHaveBeenCalledTimes(1);
  });
  it("ignores a second tap while it is in progress", async () => {
    const { port, service } = setup("prompt");
    await Promise.all([service.enable(), service.enable()]);
    expect(port.requestPermission).toHaveBeenCalledTimes(1);
  });
  it("a failing permission check or register ends in a generic retryable error", async () => {
    const first = setup();
    first.port.checkPermission.mockResolvedValueOnce(err(new NativeCapabilityError("native")));
    await first.service.enable();
    expect(first.service.getStatus()).toEqual({ state: "error" });
    const second = setup();
    second.port.register.mockResolvedValueOnce(err(new NativeCapabilityError("native")));
    await second.service.enable();
    expect(second.service.getStatus()).toEqual({ state: "error" });
    await second.service.enable();
    expect(second.port.register).toHaveBeenCalledTimes(2);
  });
  it("a listener that cannot be installed is an error", async () => {
    const { port, service } = setup();
    port.listen.mockResolvedValueOnce(err(new NativeCapabilityError("native")));
    await service.enable();
    expect(state(service)).toBe("error");
    expect(port.register).not.toHaveBeenCalled();
  });
});

describe("push device service: renewal and errors", () => {
  it("a new token does PUT and revokes the previous one; revoke failure keeps registered", async () => {
    const { api, service, emit } = setup();
    await service.resume();
    emit(A);
    await flush();
    api.revoke.mockRejectedValueOnce(new Error("down"));
    emit(B);
    await flush();
    expect(api.register).toHaveBeenLastCalledWith({ provider: "fcm", platform: "android", token: B.token });
    expect(api.revoke).toHaveBeenCalledWith({ provider: "fcm", token: A.token });
    expect(service.getStatus()).toEqual({ state: "registered", tokenHint: "****2222" });
  });
  it("a hanging revoke of the previous token does not block and gives up after the limit", async () => {
    const { api, service, emit } = setup();
    await service.resume();
    emit(A);
    await flush();
    api.revoke.mockImplementationOnce(() => new Promise(() => undefined));
    emit(B);
    await flush();
    expect(state(service)).toBe("registered");
    await vi.advanceTimersByTimeAsync(3000);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not repeat the PUT for the same token", async () => {
    const { api, service, emit } = setup();
    await service.resume();
    emit(A);
    await flush();
    emit(A);
    emit(A);
    await flush();
    expect(api.register).toHaveBeenCalledTimes(1);
    expect(api.revoke).not.toHaveBeenCalled();
    expect(state(service)).toBe("registered");
  });
  it.each([
    ["validation", { kind: "validation", fields: [{ field: "token", code: "invalid", message: "x" }] }],
    ["unauthorized", { kind: "unauthorized" }],
    ["network", { kind: "network" }],
    ["server", { kind: "server" }],
  ])("a PUT failing with %s becomes a generic error without throwing and can be retried", async (_name, error) => {
    const { api, service, emit } = setup();
    api.register.mockResolvedValueOnce({ ok: false, error } as never);
    await service.resume();
    emit(A);
    await flush();
    expect(service.getStatus()).toEqual({ state: "error" });
    await service.enable();
    emit(A);
    await flush();
    expect(api.register).toHaveBeenCalledTimes(2);
    expect(state(service)).toBe("registered");
  });
  it("a PUT that throws is also an error", async () => {
    const { api, service, emit } = setup();
    api.register.mockRejectedValueOnce(new Error("boom"));
    await service.resume();
    emit(A);
    await flush();
    expect(state(service)).toBe("error");
  });
  it("a plugin error becomes a generic error", async () => {
    const { service, fail } = setup();
    await service.resume();
    fail();
    expect(service.getStatus()).toEqual({ state: "error" });
  });
  it("never logs the token or exposes it in the status", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    const { api, service, emit, fail } = setup();
    api.register.mockRejectedValueOnce(new Error(`boom ${A.token}`));
    await service.resume();
    emit(A);
    await flush();
    fail();
    emit(B);
    await flush();
    await service.revokeBeforeLogout();
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain("SENTINEL");
    expect(JSON.stringify(service.getStatus())).not.toContain("SENTINEL");
  });
});

describe("push device service: logout and session changes", () => {
  it("revokeBeforeLogout revokes, unregisters, closes listeners and resets to off", async () => {
    const { port, api, stop, service, emit } = setup();
    await service.resume();
    emit(A);
    await flush();
    expect(await service.revokeBeforeLogout()).toEqual({ revoked: true });
    expect(api.revoke).toHaveBeenCalledWith({ provider: "fcm", token: A.token });
    expect(api.revoke.mock.invocationCallOrder[0]).toBeLessThan(port.unregister.mock.invocationCallOrder[0]);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(service.getStatus()).toEqual({ state: "off" });
  });
  it("never throws when the API rejects", async () => {
    const { api, port, service, emit } = setup();
    await service.resume();
    emit(A);
    await flush();
    api.revoke.mockRejectedValueOnce(new Error("down"));
    port.unregister.mockRejectedValueOnce(new Error("down"));
    expect(await service.revokeBeforeLogout()).toEqual({ revoked: false });
    expect(state(service)).toBe("off");
  });
  it("an API answering with failure is not revoked", async () => {
    const { api, service, emit } = setup();
    await service.resume();
    emit(A);
    await flush();
    api.revoke.mockResolvedValueOnce({ ok: false, error: { kind: "server" } } as never);
    expect(await service.revokeBeforeLogout()).toEqual({ revoked: false });
  });
  it("a hanging API resolves at 3000 ms", async () => {
    const { api, port, service, emit } = setup();
    await service.resume();
    emit(A);
    await flush();
    api.revoke.mockImplementationOnce(() => new Promise(() => undefined));
    const done = vi.fn();
    void service.revokeBeforeLogout().then(done);
    await vi.advanceTimersByTimeAsync(2999);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalledWith({ revoked: false });
    expect(port.unregister).toHaveBeenCalled();
    expect(state(service)).toBe("off");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("without a known token it only unregisters and resets", async () => {
    const { api, port, service } = setup();
    await service.resume();
    expect(await service.revokeBeforeLogout()).toEqual({ revoked: false });
    expect(api.revoke).not.toHaveBeenCalled();
    expect(port.unregister).toHaveBeenCalledTimes(1);
    expect(state(service)).toBe("off");
  });
  it("without any registration it does not touch the plugin at all", async () => {
    const { port, service } = setup();
    expect(await service.revokeBeforeLogout()).toEqual({ revoked: false });
    expect(state(service)).toBe("unsupported");
    expect(port.unregister).not.toHaveBeenCalled();
    expect(port.requestPermission).not.toHaveBeenCalled();
  });
  it("a token arriving after logout is discarded", async () => {
    const { api, service, emit } = setup();
    await service.resume();
    await service.revokeBeforeLogout();
    emit(A);
    await flush();
    expect(api.register).not.toHaveBeenCalled();
    expect(state(service)).toBe("off");
  });
  it("a PUT that finishes after logout is discarded and its token is revoked first", async () => {
    const { api, service, emit } = setup();
    let finish: (value: never) => void = () => undefined;
    api.register.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve as typeof finish; }));
    await service.resume();
    emit(A);
    await flush();
    const logout = service.revokeBeforeLogout();
    finish(record("****1111") as never);
    await logout;
    expect(api.revoke).toHaveBeenCalledWith({ provider: "fcm", token: A.token });
    expect(service.getStatus()).toEqual({ state: "off" });
  });
  it("a resume interrupted by a session change does not register with the new session", async () => {
    const { port, api, service, emit } = setup();
    let release: (value: ReturnType<typeof ok<NativePermissionState>>) => void = () => undefined;
    port.checkPermission.mockImplementationOnce(() => new Promise((resolve) => { release = resolve as typeof release; }));
    const pending = service.resume();
    await service.revokeBeforeLogout();
    release(ok("granted"));
    await pending;
    emit(A);
    await flush();
    expect(port.register).not.toHaveBeenCalled();
    expect(api.register).not.toHaveBeenCalled();
  });
  it("reset (401) clears locally without revoking", async () => {
    const { api, port, stop, service, emit } = setup();
    await service.resume();
    emit(A);
    await flush();
    service.reset();
    await flush();
    expect(api.revoke).not.toHaveBeenCalled();
    expect(port.unregister).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(service.getStatus()).toEqual({ state: "off" });
    emit(B);
    await flush();
    expect(api.register).toHaveBeenCalledTimes(1);
  });
  it("can register again after a logout", async () => {
    const { api, service, emit } = setup();
    await service.resume();
    emit(A);
    await flush();
    await service.revokeBeforeLogout();
    await service.resume();
    emit(B);
    await flush();
    expect(api.register).toHaveBeenLastCalledWith({ provider: "fcm", platform: "android", token: B.token });
    expect(state(service)).toBe("registered");
  });
});

describe("push device service: late PUT after logout, registration timeout and concurrent logout", () => {
  const BEARER = "fake-bearer-SENTINEL-OUT";
  const hang = <T,>() => new Promise<T>(() => undefined);

  it("revokes with the outgoing bearer a PUT that answers after the logout limit, without touching the new user's state", async () => {
    const { api, service, emit } = setup();
    let finish: (value: never) => void = () => undefined;
    api.register.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve as typeof finish; }));
    await service.resume();
    emit(A);
    await flush();
    api.revoke.mockImplementationOnce(() => hang());
    const done = vi.fn();
    void service.revokeBeforeLogout({ accessToken: BEARER }).then(done);
    await vi.advanceTimersByTimeAsync(3000);
    expect(done).toHaveBeenCalledWith({ revoked: false });
    expect(api.revoke).toHaveBeenCalledTimes(1);
    await service.resume();
    emit(B);
    await flush();
    expect(service.getStatus()).toEqual({ state: "registered", tokenHint: "****2222" });
    finish(record("****1111") as never);
    await flush();
    expect(api.revoke).toHaveBeenCalledTimes(2);
    expect(api.revoke).toHaveBeenLastCalledWith({ provider: "fcm", token: A.token }, { accessToken: BEARER });
    expect(service.getStatus()).toEqual({ state: "registered", tokenHint: "****2222" });
    await service.revokeBeforeLogout();
    expect(api.revoke).toHaveBeenLastCalledWith({ provider: "fcm", token: B.token });
  });
  it("ignores a late revoke that is rejected, fails or hangs, and does not revoke a late failed PUT", async () => {
    for (const outcome of ["reject", "fail", "hang", "put-fails"] as const) {
      const { api, service, emit } = setup();
      let finish: (value: never) => void = () => undefined;
      api.register.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve as typeof finish; }));
      await service.resume();
      emit(A);
      await flush();
      api.revoke.mockImplementationOnce(() => hang());
      void service.revokeBeforeLogout({ accessToken: BEARER });
      await vi.advanceTimersByTimeAsync(3000);
      if (outcome === "reject") api.revoke.mockRejectedValueOnce(new Error("401"));
      if (outcome === "fail") api.revoke.mockResolvedValueOnce({ ok: false, error: { kind: "unauthorized" } } as never);
      if (outcome === "hang") api.revoke.mockImplementationOnce(() => hang());
      finish((outcome === "put-fails" ? { ok: false, error: { kind: "server" } } : record("****1111")) as never);
      await vi.advanceTimersByTimeAsync(5000);
      expect(api.revoke).toHaveBeenCalledTimes(outcome === "put-fails" ? 1 : 2);
      expect(service.getStatus()).toEqual({ state: "off" });
      expect(vi.getTimerCount()).toBe(0);
    }
  });
  it("a PUT interrupted by reset (401) is not revoked", async () => {
    const { api, service, emit } = setup();
    let finish: (value: never) => void = () => undefined;
    api.register.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve as typeof finish; }));
    await service.resume();
    emit(A);
    await flush();
    service.reset();
    finish(record("****1111") as never);
    await flush();
    expect(api.revoke).not.toHaveBeenCalled();
  });

  it("without any event the registration ends in a retryable error after 15 s, and a late token is still accepted", async () => {
    const { port, service, emit } = setup();
    await service.resume();
    await vi.advanceTimersByTimeAsync(14999);
    expect(state(service)).toBe("registering");
    await vi.advanceTimersByTimeAsync(1);
    expect(service.getStatus()).toEqual({ state: "error" });
    emit(A);
    await flush();
    expect(service.getStatus()).toEqual({ state: "registered", tokenHint: "****1111" });
    expect(port.register).toHaveBeenCalledTimes(1);
  });
  it("enable retries after the timeout", async () => {
    const { port, service, emit } = setup();
    await service.enable();
    await vi.advanceTimersByTimeAsync(15000);
    expect(state(service)).toBe("error");
    await service.enable();
    expect(port.register).toHaveBeenCalledTimes(2);
    expect(state(service)).toBe("registering");
    emit(A);
    await flush();
    expect(state(service)).toBe("registered");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("the timeout does not fire once the token arrived and honors registrationTimeoutMs", async () => {
    const { service, emit } = setup();
    await service.resume();
    emit(A);
    await flush();
    await vi.advanceTimersByTimeAsync(60000);
    expect(state(service)).toBe("registered");
    const custom = setup();
    const service2 = createPushDeviceService({ port: custom.port, api: custom.api, registrationTimeoutMs: 500 });
    await service2.resume();
    await vi.advanceTimersByTimeAsync(500);
    expect(state(service2)).toBe("error");
  });
  it("logout clears the registration timer", async () => {
    const { service } = setup();
    await service.resume();
    await service.revokeBeforeLogout();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(20000);
    expect(state(service)).toBe("off");
  });

  it("concurrent revokeBeforeLogout calls share one operation and result", async () => {
    const { api, port, service, emit } = setup();
    await service.resume();
    emit(A);
    await flush();
    api.revoke.mockImplementationOnce(() => hang());
    const first = service.revokeBeforeLogout({ accessToken: BEARER });
    await vi.advanceTimersByTimeAsync(1000);
    const second = service.revokeBeforeLogout({ accessToken: BEARER });
    expect(second).toBe(first);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await first).toEqual({ revoked: false });
    expect(await second).toEqual({ revoked: false });
    expect(api.revoke).toHaveBeenCalledTimes(1);
    expect(port.unregister).toHaveBeenCalledTimes(1);
    await service.revokeBeforeLogout();
    expect(port.unregister).toHaveBeenCalledTimes(1);
  });
});
