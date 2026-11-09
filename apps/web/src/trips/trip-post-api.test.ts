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
  it("creates with the link fields and still drops createdAt and dayId", async () => {
    const { api, fetch } = setup({ post: post() }, 201);
    const forced = { description: "Texto", parentPostId: itineraryId(8), activityId: itineraryId(9), transportId: itineraryId(10),
      createdAt: "2020-01-01T00:00:00.000Z", dayId: itineraryId(4) } as PostInput;
    await api.create(tripId, forced);
    expect(sent(fetch)).toEqual({ url: `https://api.test/trips/${tripId}/posts`, method: "POST",
      body: { description: "Texto", parentPostId: itineraryId(8), activityId: itineraryId(9), transportId: itineraryId(10) } });
  });
  it("updates sending explicit null links, never createdAt or dayId", async () => {
    const { api, fetch } = setup({ post: post() });
    const forced = { parentPostId: itineraryId(8), activityId: null, transportId: null, createdAt: "2020-01-01T00:00:00.000Z", dayId: itineraryId(4) } as PostInput;
    await api.update(tripId, itineraryId(5), forced);
    expect(sent(fetch)).toEqual({ url: `https://api.test/trips/${tripId}/posts/${itineraryId(5)}`, method: "PATCH",
      body: { parentPostId: itineraryId(8), activityId: null, transportId: null } });
  });
  it("omits undefined link fields but keeps null ones", async () => {
    const { api, fetch } = setup({ post: post() });
    await api.update(tripId, itineraryId(5), { parentPostId: null, activityId: undefined, transportId: undefined, description: undefined });
    expect(sent(fetch).body).toEqual({ parentPostId: null });
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

describe("post HTTP adapter with a new activity", () => {
  const scheduledAt = "2026-09-25T15:00:00.000Z";
  const newActivity = { title: "Cena", scheduledAt, durationMinutes: 90 };
  const activity = (extra: Record<string, unknown> = {}) => ({ id: itineraryId(8), tripId, dayId: itineraryId(4), title: "Cena", description: null, mapsUrl: null,
    scheduledAt, durationMinutes: 90, createdAt: "2026-09-25T10:00:00.123Z", createdBy: itineraryId(20), ...extra });
  const participation = { id: itineraryId(50), tripId, activityId: itineraryId(8), userId: itineraryId(20), status: "going", updatedAt: "2026-09-25T12:00:00.123Z" };
  const confirmation = { confirmedConflicts: [{ activityId: itineraryId(9), reason: "overlap" as const, scheduledAt: "2026-09-25T14:30:00.000Z", durationMinutes: 60 }],
    confirmedActivity: { scheduledAt, durationMinutes: 90 } };
  const conflictBody = { error: { code: "ParticipationConflictError", message: "x", conflicts: confirmation.confirmedConflicts, activity: confirmation.confirmedActivity } };
  it("creates sending newActivity and the confirmation at the root, and returns activity and participation", async () => {
    const { api, fetch } = setup({ post: post(), activity: activity(), participation }, 201);
    const result = await api.create(tripId, { description: "Texto", newActivity }, confirmation);
    expect(result).toEqual({ ok: true, value: { ...post(), activity: activity(), participation } });
    expect(sent(fetch)).toEqual({ url: `https://api.test/trips/${tripId}/posts`, method: "POST",
      body: { description: "Texto", newActivity, confirmedConflicts: confirmation.confirmedConflicts, confirmedActivity: confirmation.confirmedActivity } });
  });
  it("never sends dayId inside newActivity or at the root, even when forced", async () => {
    const { api, fetch } = setup({ post: post(), activity: activity(), participation }, 201);
    await api.create(tripId, { description: "Texto", dayId: itineraryId(4), newActivity: { ...newActivity, dayId: itineraryId(4) } } as PostInput);
    expect(sent(fetch).body).toEqual({ description: "Texto", newActivity });
  });
  it("updates sending newActivity with an explicit null parent and the confirmation", async () => {
    const { api, fetch } = setup({ post: post(), activity: activity(), participation });
    const result = await api.update(tripId, itineraryId(5), { parentPostId: null, newActivity }, confirmation);
    expect(result).toEqual({ ok: true, value: { ...post(), activity: activity(), participation } });
    expect(sent(fetch)).toEqual({ url: `https://api.test/trips/${tripId}/posts/${itineraryId(5)}`, method: "PATCH",
      body: { parentPostId: null, newActivity, confirmedConflicts: confirmation.confirmedConflicts, confirmedActivity: confirmation.confirmedActivity } });
  });
  it("keeps a saved activity with participation null when the participation is invalid", async () => {
    const { api } = setup({ post: post(), activity: activity(), participation: { ...participation, status: "confirmed" } }, 201);
    expect(await api.create(tripId, { description: "Texto", newActivity })).toEqual({ ok: true, value: { ...post(), activity: activity(), participation: null } });
  });
  it.each([["missing", undefined], ["from another trip", activity({ tripId: itineraryId(2) })], ["without a title", activity({ title: "" })]])(
    "is a server failure when newActivity was sent and the response activity is %s", async (_name, value) => {
      expect(await setup({ post: post(), activity: value }, 201).api.create(tripId, { description: "Texto", newActivity })).toEqual({ ok: false, error: { kind: "server" } });
      expect(await setup({ post: post(), activity: value }).api.update(tripId, itineraryId(5), { newActivity })).toEqual({ ok: false, error: { kind: "server" } });
    });
  it("returns only the post when no newActivity was sent, ignoring any activity in the response", async () => {
    const result = await setup({ post: post(), activity: activity(), participation }, 201).api.create(tripId, { description: "Texto" });
    expect(result).toStrictEqual({ ok: true, value: post() });
  });
  it("maps a valid 409 to participation-conflict on create and update", async () => {
    expect(await setup(conflictBody, 409).api.create(tripId, { newActivity })).toEqual({ ok: false, error: { kind: "participation-conflict", confirmation } });
    expect(await setup(conflictBody, 409).api.update(tripId, itineraryId(5), { newActivity })).toEqual({ ok: false, error: { kind: "participation-conflict", confirmation } });
  });
  it("treats a malformed 409 as a server failure", async () => {
    expect(await setup({ error: { code: "ParticipationConflictError", message: "x", conflicts: [] } }, 409).api.create(tripId, { newActivity })).toEqual({ ok: false, error: { kind: "server" } });
  });
  it.each([["scheduledAt"], ["durationMinutes"]])("keeps the %s validation field with its code from a 422", async (field) => {
    const { api } = setup({ error: { code: "ValidationError", message: "x", fields: [{ field, code: "outside_window", message: "Fuera" }] } }, 422);
    expect(await api.create(tripId, { newActivity })).toEqual({ ok: false, error: { kind: "validation", fields: [{ field, code: "outside_window", message: "Fuera" }] } });
  });
  it("does not change the request without newActivity or confirmation", async () => {
    const { api, fetch } = setup({ post: post() }, 201);
    await api.create(tripId, { description: "Texto" });
    expect(sent(fetch).body).toEqual({ description: "Texto" });
  });
});
