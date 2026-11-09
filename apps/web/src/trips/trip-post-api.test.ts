import { describe, expect, it, vi } from "vitest";
import { createHttpClient } from "../api/index.js";
import { itineraryId } from "./itinerary-test-fixture.js";
import { createTripPostApi, type PostInput, type PostResponse } from "./trip-post-api.js";

const tripId = itineraryId(1);
const post = (n = 5, extra: Record<string, unknown> = {}): PostResponse => ({ id: itineraryId(n), tripId, authorId: itineraryId(20), description: "Texto",
  mapsUrl: null, activityId: null, parentPostId: null, transportId: null, createdAt: "2026-09-25T10:00:00.123Z", ...extra } as PostResponse);
const setup = (body: unknown, status = 200) => {
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status }));
  const client = createHttpClient({ baseUrl: "https://api.test", fetch, getAccessToken: async () => "token", onUnauthorized: vi.fn() });
  return { api: createTripPostApi(client), fetch };
};
const sent = (fetch: ReturnType<typeof vi.fn>) => ({ url: fetch.mock.calls[0][0] as string, method: fetch.mock.calls[0][1].method as string,
  body: fetch.mock.calls[0][1].body === undefined ? undefined : JSON.parse(fetch.mock.calls[0][1].body) });

describe("post HTTP adapter", () => {
  it("creates with exactly the content fields and never sends createdAt or dayId, even when forced", async () => {
    const { api, fetch } = setup({ post: post() }, 201);
    const forced = { description: "Texto", mapsUrl: "https://maps.test/x", createdAt: "2020-01-01T00:00:00.000Z", dayId: itineraryId(4) } as PostInput;
    expect(await api.create(tripId, forced)).toEqual({ ok: true, value: post() });
    expect(sent(fetch)).toEqual({ url: `https://api.test/trips/${tripId}/posts`, method: "POST",
      body: { description: "Texto", mapsUrl: "https://maps.test/x" } });
  });
  it("updates sending only the changed fields", async () => {
    const { api, fetch } = setup({ post: post(5, { description: null }) });
    expect((await api.update(tripId, itineraryId(5), { description: null })).ok).toBe(true);
    expect(sent(fetch)).toEqual({ url: `https://api.test/trips/${tripId}/posts/${itineraryId(5)}`, method: "PATCH", body: { description: null } });
  });
  it("never sends publication date or day on update either", async () => {
    const { api, fetch } = setup({ post: post() });
    await api.update(tripId, itineraryId(5), { description: "x", createdAt: "2020-01-01T00:00:00.000Z", dayId: itineraryId(4) } as PostInput);
    expect(sent(fetch).body).toEqual({ description: "x" });
  });
  it("accepts a valid response with extra fields and a legacy dayId", async () => {
    const value = post(5, { dayId: itineraryId(4), likes: 3, context: {} });
    const { api } = setup({ post: value });
    expect(await api.create(tripId, { description: "Texto" })).toEqual({ ok: true, value: post() });
  });
  it("tolerates absent link fields as null", async () => {
    const value: Record<string, unknown> = { ...post() };
    delete value.activityId; delete value.parentPostId; delete value.transportId;
    const { api } = setup({ post: value });
    expect(await api.create(tripId, { description: "Texto" })).toEqual({ ok: true, value: post() });
  });
  it.each([
    ["another tripId", { tripId: itineraryId(2) }], ["a malformed createdAt", { createdAt: "ayer" }],
    ["a numeric description", { description: 4 }], ["a missing authorId", { authorId: undefined }], ["a malformed link", { activityId: "x" }],
  ])("rejects a response with %s as a server failure", async (_name, override) => {
    const { api } = setup({ post: post(5, override) });
    expect(await api.create(tripId, { description: "Texto" })).toEqual({ ok: false, error: { kind: "server" } });
  });
  it("keeps validation fields from a 422", async () => {
    const { api } = setup({ error: { code: "ValidationError", message: "x", fields: [{ field: "mapsUrl", code: "invalid", message: "Link inválido" }] } }, 422);
    expect(await api.create(tripId, { mapsUrl: "x" })).toEqual({ ok: false, error: { kind: "validation", fields: [{ field: "mapsUrl", code: "invalid", message: "Link inválido" }] } });
  });
  it.each([[404, "not-found"], [401, "unauthorized"], [403, "forbidden"]])("maps HTTP %i to %s", async (status, kind) => {
    const { api } = setup({}, status);
    expect(await api.update(tripId, itineraryId(5), { description: "x" })).toEqual({ ok: false, error: { kind } });
  });
  it("maps a network failure", async () => {
    const client = createHttpClient({ baseUrl: "https://api.test", fetch: vi.fn().mockRejectedValue(new Error("down")), getAccessToken: async () => "t", onUnauthorized: vi.fn() });
    expect(await createTripPostApi(client).create(tripId, { description: "x" })).toEqual({ ok: false, error: { kind: "network" } });
  });
  it("lists preserving the received order and requests the trip posts", async () => {
    const values = [post(7), post(5), post(6)];
    const { api, fetch } = setup({ posts: values });
    expect(await api.list(tripId)).toEqual({ ok: true, value: values });
    expect(sent(fetch)).toMatchObject({ url: `https://api.test/trips/${tripId}/posts`, method: "GET" });
  });
  it("fails the whole list when an item has no id or createdAt", async () => {
    const broken = { ...post(6) } as Record<string, unknown>; delete broken.createdAt;
    expect(await setup({ posts: [post(5), broken] }).api.list(tripId)).toEqual({ ok: false, error: { kind: "server" } });
    const noId = { ...post(6) } as Record<string, unknown>; delete noId.id;
    expect(await setup({ posts: [noId] }).api.list(tripId)).toEqual({ ok: false, error: { kind: "server" } });
  });
  it("gets a post, validates it and tolerates parent and children", async () => {
    const detail = { post: post(), parent: null, children: [{ anything: true }], rootActivityId: null };
    const { api, fetch } = setup(detail);
    expect(await api.get(tripId, itineraryId(5))).toEqual({ ok: true, value: detail });
    expect(sent(fetch).url).toBe(`https://api.test/trips/${tripId}/posts/${itineraryId(5)}`);
    expect(await setup({ ...detail, post: post(5, { createdAt: 1 }) }).api.get(tripId, itineraryId(5))).toEqual({ ok: false, error: { kind: "server" } });
  });
  it("rejects a fetched post whose id differs from the requested one", async () => {
    expect(await setup({ post: post(6), parent: null, children: [], rootActivityId: null }).api.get(tripId, itineraryId(5))).toEqual({ ok: false, error: { kind: "server" } });
  });
});
