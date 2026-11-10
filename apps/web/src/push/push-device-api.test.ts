import { describe, expect, it, vi } from "vitest";
import { createHttpClient } from "../api/index.js";
import { createPushDeviceApi } from "./push-device-api.js";

const TOKEN = "fake-token-SENTINEL-1234567890";
const device = { id: "a".repeat(24), provider: "fcm", platform: "android", tokenHint: "****7890", registeredAt: "2026-11-10T10:00:00.000Z" };
const setup = (body: unknown, status = 200) => {
  const fetch = vi.fn().mockImplementation(async () => status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status }));
  const client = createHttpClient({ baseUrl: "https://api.test", fetch, getAccessToken: async () => "bearer", onUnauthorized: vi.fn() });
  return { api: createPushDeviceApi(client), fetch };
};
const sent = (fetch: ReturnType<typeof vi.fn>) => ({ url: fetch.mock.calls[0][0] as string, method: fetch.mock.calls[0][1].method as string, body: JSON.parse(fetch.mock.calls[0][1].body as string) as unknown });
const input = { provider: "fcm", platform: "android", token: TOKEN } as const;
const server = { ok: false, error: { kind: "server" } };

describe("push device API: register", () => {
  it("sends PUT /push-devices and returns only id, tokenHint and registeredAt", async () => {
    const { api, fetch } = setup({ device });
    const result = await api.register(input);
    expect(result).toEqual({ ok: true, value: { id: device.id, tokenHint: "****7890", registeredAt: device.registeredAt } });
    expect(sent(fetch)).toEqual({ url: "https://api.test/push-devices", method: "PUT", body: { provider: "fcm", platform: "android", token: TOKEN } });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
  it.each([
    ["no device", {}],
    ["an invalid provider", { device: { ...device, provider: "x" } }],
    ["an invalid platform", { device: { ...device, platform: "web" } }],
    ["another provider than sent", { device: { ...device, provider: "apns" } }],
    ["another platform than sent", { device: { ...device, platform: "ios" } }],
    ["a non string tokenHint", { device: { ...device, tokenHint: 5 } }],
    ["a missing id", { device: { ...device, id: undefined } }],
    ["a missing registeredAt", { device: { ...device, registeredAt: undefined } }],
  ])("answers server for %s", async (_name, body) => {
    expect(await setup(body).api.register(input)).toEqual(server);
  });
  it("maps 422 with fields, 401, network and 5xx without leaking the token", async () => {
    const fields = [{ field: "token", code: "invalid", message: `bad ${TOKEN}` }, { field: "provider", code: "invalid", message: "Proveedor inválido" }];
    const validation = await setup({ error: { code: "ValidationError", message: `x ${TOKEN}`, fields } }, 422).api.register(input);
    expect(validation).toMatchObject({ ok: false, error: { kind: "validation" } });
    expect(JSON.stringify(validation)).not.toContain(TOKEN);
    expect(validation.ok === false && validation.error.fields?.map((f) => f.field)).toEqual(["token", "provider"]);
    expect(await setup({ error: { code: "Unauthorized", message: "x" } }, 401).api.register(input)).toEqual({ ok: false, error: { kind: "unauthorized" } });
    expect(await setup({}, 503).api.register(input)).toEqual(server);
    const fetch = vi.fn().mockRejectedValue(new Error(`boom ${TOKEN}`));
    const api = createPushDeviceApi(createHttpClient({ baseUrl: "https://api.test", fetch, getAccessToken: async () => "b", onUnauthorized: vi.fn() }));
    const network = await api.register(input);
    expect(network).toEqual({ ok: false, error: { kind: "network" } });
    expect(JSON.stringify(network)).not.toContain(TOKEN);
  });
});

describe("push device API: revoke", () => {
  it("posts the token in the body, never in the URL, and accepts 204", async () => {
    const { api, fetch } = setup(undefined, 204);
    expect(await api.revoke({ provider: "fcm", token: TOKEN })).toEqual({ ok: true, value: undefined });
    const request = sent(fetch);
    expect(request).toEqual({ url: "https://api.test/push-devices/revoke", method: "POST", body: { provider: "fcm", token: TOKEN } });
    expect(request.url).not.toContain(TOKEN);
  });
  it("revokes with an explicit bearer without asking for the current one", async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response(null, { status: 204 }));
    const getAccessToken = vi.fn(async () => "current-bearer");
    const api = createPushDeviceApi(createHttpClient({ baseUrl: "https://api.test", fetch, getAccessToken, onUnauthorized: vi.fn() }));
    expect(await api.revoke({ provider: "fcm", token: TOKEN }, { accessToken: "outgoing-bearer" })).toEqual({ ok: true, value: undefined });
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetch.mock.calls[0][1].headers).toMatchObject({ Authorization: "Bearer outgoing-bearer" });
    expect(sent(fetch).body).toEqual({ provider: "fcm", token: TOKEN });
  });
  it("maps failures without the token", async () => {
    expect(await setup({ error: { code: "ValidationError", message: TOKEN, fields: [{ field: "token", code: "invalid", message: TOKEN }] } }, 422).api.revoke({ provider: "fcm", token: TOKEN })).toMatchObject({ ok: false, error: { kind: "validation" } });
    const failed = await setup({ error: { code: "ValidationError", message: TOKEN, fields: [{ field: "token", code: "invalid", message: TOKEN }] } }, 422).api.revoke({ provider: "fcm", token: TOKEN });
    expect(JSON.stringify(failed)).not.toContain(TOKEN);
    expect(await setup({}, 401).api.revoke({ provider: "fcm", token: TOKEN })).toEqual({ ok: false, error: { kind: "unauthorized" } });
    expect(await setup({}, 500).api.revoke({ provider: "fcm", token: TOKEN })).toEqual(server);
    const fetch = vi.fn().mockRejectedValue(new Error("down"));
    const api = createPushDeviceApi(createHttpClient({ baseUrl: "https://api.test", fetch, getAccessToken: async () => "b", onUnauthorized: vi.fn() }));
    expect(await api.revoke({ provider: "fcm", token: TOKEN })).toEqual({ ok: false, error: { kind: "network" } });
  });
});
