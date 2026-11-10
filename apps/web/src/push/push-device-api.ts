import type { ApiClientError, HttpClient } from "../api/index.js";
import { isId, isRecord, isTimestamp } from "../trips/api-failure.js";
import type { TripResult } from "../trips/trip-management-api.js";

export type PushProvider = "fcm" | "apns";
export type PushPlatform = "android" | "ios";
export type PushRegistration = { provider: PushProvider; platform: PushPlatform; token: string };
/** What the client keeps of a registration: never the token. */
export type PushDeviceRecord = { id: string; tokenHint: string; registeredAt: string };
export type PushDeviceApi = {
  /** Idempotent upsert of this device token for the authenticated user. */
  register: (input: PushRegistration) => Promise<TripResult<PushDeviceRecord>>;
  /** The token travels in the body, never in the URL; 204 also when it was unknown. */
  revoke: (input: { provider: PushProvider; token: string }, options?: { accessToken?: string }) => Promise<TripResult<undefined>>;
};

const serverFailure: TripResult<never> = { ok: false, error: { kind: "server" } };
const isProvider = (value: unknown): value is PushProvider => value === "fcm" || value === "apns";
const isPlatform = (value: unknown): value is PushPlatform => value === "android" || value === "ios";

/** Only kind and sanitized fields travel; nothing that contains the token is kept. */
const failure = (error: ApiClientError, token: string): TripResult<never> => ({
  ok: false,
  error: {
    kind: error.kind,
    ...(error.fields ? { fields: error.fields.map(({ field, code, message }) => ({ field, code, message: message.includes(token) ? "" : message })).filter(({ field, code }) => !field.includes(token) && !code.includes(token)) } : {}),
  },
});

export const createPushDeviceApi = (client: Pick<HttpClient, "put" | "post">): PushDeviceApi => ({
  register: async (input) => {
    const result = await client.put<unknown>("/push-devices", { provider: input.provider, platform: input.platform, token: input.token });
    if (!result.ok) return failure(result.error, input.token);
    const device = isRecord(result.value) ? result.value.device : undefined;
    if (!isRecord(device) || !isId(device.id) || !isProvider(device.provider) || !isPlatform(device.platform) || typeof device.tokenHint !== "string" ||
      !isTimestamp(device.registeredAt) || device.provider !== input.provider || device.platform !== input.platform) return serverFailure;
    return { ok: true, value: { id: device.id, tokenHint: device.tokenHint, registeredAt: device.registeredAt } };
  },
  revoke: async (input, options) => {
    // An explicit bearer (the outgoing session's) is sent as is; the current one is not consulted.
    const result = await client.post<unknown>("/push-devices/revoke", { provider: input.provider, token: input.token },
      options?.accessToken ? { authenticated: false, headers: { Authorization: `Bearer ${options.accessToken}` } } : undefined);
    return result.ok ? { ok: true, value: undefined } : failure(result.error, input.token);
  },
});
