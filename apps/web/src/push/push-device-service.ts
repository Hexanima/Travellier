import type { NativePermissionState, NativePushToken, PushRegistrationPort } from "app-domain";
import type { PushDeviceApi } from "./push-device-api.js";

/**
 * Observable registration state. It never carries the token, only the server hint.
 * `unsupported` is also the state before the first check, so nothing is rendered until the platform is known.
 */
export type PushStatus =
  | { state: "unsupported" }
  | { state: "off" }
  | { state: "requesting" }
  | { state: "registering" }
  | { state: "registered"; tokenHint: string }
  | { state: "denied" }
  | { state: "error" };

export type PushDeviceService = {
  getStatus: () => PushStatus;
  subscribe: (listener: () => void) => () => void;
  /** Silent: only reads the permission; never shows a dialog. */
  refreshStatus: () => Promise<void>;
  /** On session start: registers only if the permission is already granted; never prompts. */
  resume: () => Promise<void>;
  /** Explicit user action: asks for the permission when still undecided, then registers. */
  enable: () => Promise<void>;
  /**
   * Revokes the token on the server (bounded), unregisters and resets; never throws and never blocks logout for long.
   * `accessToken` is the outgoing session's bearer: PUTs still in flight are revoked with it when they answer late.
   * Concurrent calls share the same operation.
   */
  revokeBeforeLogout: (options?: { accessToken?: string }) => Promise<{ revoked: boolean }>;
  /** Local reset (e.g. after a 401): no authentication, so nothing is revoked. */
  reset: () => void;
};

type Dependencies = { port: PushRegistrationPort; api: PushDeviceApi; revokeTimeoutMs?: number; registrationTimeoutMs?: number };

const busyStates: readonly PushStatus["state"][] = ["requesting", "registering", "registered"];
const same = (a: NativePushToken, b: NativePushToken) => a.token === b.token && a.provider === b.provider;
const safe = (operation: () => unknown): Promise<void> => {
  try { return Promise.resolve(operation()).then(() => undefined, () => undefined); } catch { return Promise.resolve(); }
};

export const createPushDeviceService = ({ port, api, revokeTimeoutMs = 3000, registrationTimeoutMs = 15000 }: Dependencies): PushDeviceService => {
  let status: PushStatus = { state: "unsupported" };
  const listeners = new Set<() => void>();
  // The token lives only here, in memory.
  let token: NativePushToken | undefined;
  let tokenHint = "";
  const pending: NativePushToken[] = [];
  const orphans: NativePushToken[] = [];
  let stop: (() => Promise<unknown>) | undefined;
  let started = false;
  let loggingOut = false;
  let generation = 0;
  let registrationTimer: ReturnType<typeof setTimeout> | undefined;
  let logoutInFlight: Promise<{ revoked: boolean }> | undefined;
  // Generations ended by a logout: the outgoing bearer and whether the logout already took its snapshot of tokens.
  const outgoing = new Map<number, { bearer: string | undefined; snapshotted: boolean }>();
  let chain: Promise<void> = Promise.resolve();
  let entry: { promise: Promise<void>; generation: number } | undefined;

  const setStatus = (next: PushStatus) => {
    if (next.state === status.state && (next.state !== "registered" || (status.state === "registered" && status.tokenHint === next.tokenHint))) return;
    status = next;
    for (const listener of [...listeners]) listener();
  };
  const deadline = () => {
    let id: ReturnType<typeof setTimeout> | undefined;
    const promise = new Promise<false>((resolve) => { id = setTimeout(() => resolve(false), revokeTimeoutMs); });
    return { promise, cancel: () => clearTimeout(id) };
  };
  const clearRegistrationTimer = () => { if (registrationTimer !== undefined) clearTimeout(registrationTimer); registrationTimer = undefined; };
  const revokeOne = async (value: NativePushToken, bearer?: string): Promise<boolean> => {
    try {
      const input = { provider: value.provider, token: value.token };
      return (await (bearer === undefined ? api.revoke(input) : api.revoke(input, { accessToken: bearer }))).ok;
    } catch { return false; }
  };
  const revokeBounded = async (values: readonly NativePushToken[], bearer?: string): Promise<boolean> => {
    const limit = deadline();
    try {
      return await Promise.race([Promise.all(values.map((value) => revokeOne(value, bearer))).then((results) => results.every(Boolean)), limit.promise]);
    } finally { limit.cancel(); }
  };
  const closeAndUnregister = () => {
    const close = stop;
    stop = undefined;
    started = false;
    return Promise.all([close ? safe(close) : Promise.resolve(), safe(() => port.unregister())]).then(() => undefined);
  };
  const clearMemory = () => { token = undefined; tokenHint = ""; pending.length = 0; orphans.length = 0; };
  const offUnlessUnknown = () => { if (status.state !== "unsupported") setStatus({ state: "off" }); };
  const once = (operation: (current: number) => Promise<void>): Promise<void> => {
    if (entry && entry.generation === generation) return entry.promise;
    const current = generation;
    const promise: Promise<void> = operation(current).catch(() => { if (current === generation) setStatus({ state: "error" }); }).finally(() => { if (entry?.promise === promise) entry = undefined; });
    entry = { promise, generation: current };
    return promise;
  };

  const handleToken = async (value: NativePushToken, current: number): Promise<void> => {
    if (current !== generation) return;
    if (token && same(token, value)) { setStatus({ state: "registered", tokenHint }); return; }
    pending.push(value);
    if (status.state !== "registered") setStatus({ state: "registering" });
    let result: Awaited<ReturnType<PushDeviceApi["register"]>> | undefined;
    try { result = await api.register({ provider: value.provider, platform: value.platform, token: value.token }); } catch { result = undefined; }
    const index = pending.indexOf(value);
    if (index >= 0) pending.splice(index, 1);
    if (current !== generation) {
      const ended = outgoing.get(current);
      if (result?.ok && ended) {
        // Still an orphan: the logout revokes it if it has not taken its snapshot yet; otherwise revoke it now with the outgoing bearer.
        if (!ended.snapshotted && loggingOut) orphans.push(value);
        else void revokeBounded([value], ended.bearer);
      }
      return;
    }
    if (!result?.ok) { setStatus({ state: "error" }); return; }
    const previous = token;
    token = value;
    tokenHint = result.value.tokenHint;
    setStatus({ state: "registered", tokenHint });
    if (previous && !same(previous, value)) void revokeBounded([previous]);
  };

  const start = async (current: number): Promise<void> => {
    started = true;
    setStatus({ state: "registering" });
    clearRegistrationTimer();
    registrationTimer = setTimeout(() => {
      registrationTimer = undefined;
      if (current === generation && status.state === "registering") setStatus({ state: "error" });
    }, registrationTimeoutMs);
    if (!stop) {
      const listened = await port.listen({
        onToken: (value) => {
          if (current !== generation) return;
          clearRegistrationTimer();
          chain = chain.then(() => handleToken(value, current)).catch(() => undefined);
        },
        onError: () => { if (current === generation && status.state !== "registered") { clearRegistrationTimer(); setStatus({ state: "error" }); } },
      });
      if (current !== generation) { if (listened.ok) void safe(listened.value); return; }
      if (!listened.ok) { clearRegistrationTimer(); setStatus({ state: "error" }); return; }
      stop = listened.value;
    }
    const registered = await port.register();
    if (current !== generation) return;
    if (!registered.ok) { clearRegistrationTimer(); setStatus({ state: registered.error.kind === "denied" ? "denied" : "error" }); }
  };

  const permissionStatus = (permission: NativePermissionState): PushStatus => permission === "denied" ? { state: "denied" } : { state: "off" };
  const granted = (permission: NativePermissionState) => permission === "granted" || permission === "limited";

  const logout = async (bearer: string | undefined): Promise<{ revoked: boolean }> => {
    const ended = { bearer, snapshotted: false };
    outgoing.set(generation, ended);
    generation += 1;
    clearRegistrationTimer();
    if (!started && !token && pending.length === 0) { ended.snapshotted = true; clearMemory(); offUnlessUnknown(); return { revoked: false }; }
    loggingOut = true;
    const limit = deadline();
    let revoked = false;
    try {
      // Let an in-flight PUT settle so that its token is also revoked, in order.
      await Promise.race([chain, limit.promise]);
      const known = [token, ...orphans, ...pending].filter((value): value is NativePushToken => value !== undefined)
        .filter((value, index, all) => all.findIndex((other) => same(other, value)) === index);
      ended.snapshotted = true;
      clearMemory();
      if (known.length > 0) revoked = await Promise.race([revokeBounded(known, bearer), limit.promise]);
    } catch { revoked = false; }
    ended.snapshotted = true;
    await Promise.race([closeAndUnregister(), limit.promise]);
    limit.cancel();
    loggingOut = false;
    clearMemory();
    chain = Promise.resolve();
    offUnlessUnknown();
    return { revoked };
  };

  return {
    getStatus: () => status,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refreshStatus: async () => {
      if (busyStates.includes(status.state)) return;
      const current = generation;
      const result = await port.checkPermission();
      if (current !== generation || busyStates.includes(status.state)) return;
      if (!result.ok) setStatus(result.error.kind === "unsupported" ? { state: "unsupported" } : { state: "error" });
      else setStatus(permissionStatus(result.value));
    },
    resume: () => {
      if (busyStates.includes(status.state)) return Promise.resolve();
      return once(async (current) => {
        const result = await port.checkPermission();
        if (current !== generation) return;
        if (!result.ok) { if (result.error.kind === "unsupported") setStatus({ state: "unsupported" }); return; }
        if (!granted(result.value)) { setStatus(permissionStatus(result.value)); return; }
        await start(current);
      });
    },
    enable: () => {
      if (busyStates.includes(status.state)) return Promise.resolve();
      return once(async (current) => {
        const checked = await port.checkPermission();
        if (current !== generation) return;
        if (!checked.ok) { setStatus(checked.error.kind === "unsupported" ? { state: "unsupported" } : { state: "error" }); return; }
        let permission = checked.value;
        if (permission === "prompt" || permission === "prompt-with-rationale") {
          setStatus({ state: "requesting" });
          const requested = await port.requestPermission();
          if (current !== generation) return;
          if (!requested.ok) { setStatus(requested.error.kind === "unsupported" ? { state: "unsupported" } : { state: "error" }); return; }
          permission = requested.value;
        }
        if (!granted(permission)) { setStatus(permissionStatus(permission)); return; }
        await start(current);
      });
    },
    revokeBeforeLogout: (options) => {
      if (logoutInFlight) return logoutInFlight;
      const promise: Promise<{ revoked: boolean }> = logout(options?.accessToken).finally(() => { if (logoutInFlight === promise) logoutInFlight = undefined; });
      logoutInFlight = promise;
      return promise;
    },
    reset: () => {
      generation += 1;
      clearRegistrationTimer();
      const had = started;
      clearMemory();
      chain = Promise.resolve();
      if (had) void closeAndUnregister();
      offUnlessUnknown();
    },
  };
};
