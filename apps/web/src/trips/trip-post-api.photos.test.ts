import { describe, expect, it, vi } from "vitest";
import { createHttpClient } from "../api/index.js";
import { itineraryId } from "./itinerary-test-fixture.js";
import { createTripPostApi, type PostResponse } from "./trip-post-api.js";

const tripId = itineraryId(1), postId = itineraryId(5);
const post = (extra: Record<string, unknown> = {}) => ({ id: postId, tripId, authorId: itineraryId(20), description: "Texto", mapsUrl: null, activityId: null,
  parentPostId: null, transportId: null, createdAt: "2026-09-25T10:00:00.123Z", ...extra } as PostResponse);
const setup = (body: unknown, status = 200) => {
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status }));
  const client = createHttpClient({ baseUrl: "https://api.test", fetch, getAccessToken: async () => "token", onUnauthorized: vi.fn() });
  return { api: createTripPostApi(client), fetch };
};
const bodyOf = (fetch: ReturnType<typeof vi.fn>) => JSON.parse(fetch.mock.calls[0][1].body);
const photos = [{ key: `trips/${tripId}/photos/a` }, { key: `trips/${tripId}/photos/b` }];

describe("post HTTP adapter with photos", () => {
  it("sends the photo keys in order on create and on update, and nothing else about them", async () => {
    const created = setup({ post: post() }, 201);
    await created.api.create(tripId, { description: "Texto", photos: [{ key: photos[0]!.key, extra: "x" } as { key: string }, photos[1]!] });
    expect(bodyOf(created.fetch)).toEqual({ description: "Texto", photos });
    const updated = setup({ post: post() });
    await updated.api.update(tripId, postId, { photos });
    expect(bodyOf(updated.fetch)).toEqual({ photos });
  });
  it("does not send photos when there are none", async () => {
    const { api, fetch } = setup({ post: post() }, 201);
    await api.create(tripId, { description: "Texto" });
    expect(bodyOf(fetch)).toEqual({ description: "Texto" });
  });
  it("tolerates the shape of the photos in the answer: the post is already saved", async () => {
    for (const answer of [[{ id: itineraryId(60), order: 0 }], [{ nope: 1 }], "x", null]) {
      const { api } = setup({ post: post(), photos: answer }, 201);
      expect(await api.create(tripId, { photos })).toEqual({ ok: true, value: post() });
    }
  });
  it("keeps the code of a photo conflict as a server failure", async () => {
    const { api } = setup({ error: { code: "PhotoConflictError", message: "x" } }, 409);
    expect(await api.create(tripId, { photos })).toEqual({ ok: false, error: { kind: "server", code: "PhotoConflictError" } });
    const other = setup({ error: { code: "SomethingElse", message: "x" } }, 409);
    expect(await other.api.update(tripId, postId, { photos })).toEqual({ ok: false, error: { kind: "server" } });
  });
  it("propagates the per-photo validation fields", async () => {
    const fields = [{ field: "photos[1].key", code: "not_uploaded", message: "m" }, { field: "photos", code: "too_many", message: "m" }];
    const { api } = setup({ error: { code: "ValidationError", message: "x", fields } }, 422);
    expect(await api.create(tripId, { photos })).toEqual({ ok: false, error: { kind: "validation", fields } });
  });
});
