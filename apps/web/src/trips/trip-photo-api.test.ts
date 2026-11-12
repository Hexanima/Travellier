import { describe, expect, it, vi } from "vitest";
import { createHttpClient } from "../api/index.js";
import { itineraryId } from "./itinerary-test-fixture.js";
import { createTripPhotoApi } from "./trip-photo-api.js";

const tripId = itineraryId(1);
const files = [{ contentType: "image/jpeg", sizeBytes: 1000 }, { contentType: "image/png", sizeBytes: 2000 }];
const upload = (n: number, extra: Record<string, unknown> = {}) => ({ key: `trips/${tripId}/photos/key-${n}`, uploadUrl: `https://bucket.s3.test/key-${n}?sig=x`,
  headers: { "content-type": "image/jpeg" }, expiresAt: "2026-11-10T12:15:00.000Z", ...extra });
const setup = (body: unknown, status = 201) => {
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status }));
  const client = createHttpClient({ baseUrl: "https://api.test", fetch, getAccessToken: async () => "token", onUnauthorized: vi.fn() });
  return { api: createTripPhotoApi(client), fetch };
};
const valid = (uploads: unknown[]) => setup({ uploads }).api.reserve(tripId, files);

describe("photo upload reservation adapter", () => {
  it("posts the declared files to the trip's photo-uploads path", async () => {
    const { api, fetch } = setup({ uploads: [upload(1), upload(2)] });
    await api.reserve(tripId, files);
    expect(fetch.mock.calls[0][0]).toBe(`https://api.test/trips/${tripId}/photo-uploads`);
    expect(fetch.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ files });
  });
  it("returns the targets in order, with the expiry as a timestamp", async () => {
    expect(await valid([upload(1), upload(2)])).toEqual({ ok: true, value: [
      { key: `trips/${tripId}/photos/key-1`, uploadUrl: "https://bucket.s3.test/key-1?sig=x", headers: { "content-type": "image/jpeg" }, expiresAt: Date.parse("2026-11-10T12:15:00.000Z") },
      { key: `trips/${tripId}/photos/key-2`, uploadUrl: "https://bucket.s3.test/key-2?sig=x", headers: { "content-type": "image/jpeg" }, expiresAt: Date.parse("2026-11-10T12:15:00.000Z") }] });
  });
  it("rejects any other shape as a server failure", async () => {
    const bad: unknown[][] = [
      [upload(1)], [upload(1), upload(2), upload(3)], [upload(1), upload(1)],
      [upload(1), upload(2, { key: "trips/other/photos/k" })], [upload(1), upload(2, { key: 5 })],
      [upload(1), upload(2, { uploadUrl: "http://bucket.s3.test/k" })], [upload(1), upload(2, { uploadUrl: "not a url" })],
      [upload(1), upload(2, { headers: [] })], [upload(1), upload(2, { headers: { a: 1 } })], [upload(1), upload(2, { headers: null })],
      [upload(1), upload(2, { expiresAt: "ayer" })], [upload(1), upload(2, { expiresAt: 12 })], [upload(1), "x"],
    ];
    for (const uploads of bad) expect(await valid(uploads), JSON.stringify(uploads)).toEqual({ ok: false, error: { kind: "server" } });
    expect(await setup({}).api.reserve(tripId, files)).toEqual({ ok: false, error: { kind: "server" } });
    expect(await setup({ uploads: "x" }).api.reserve(tripId, files)).toEqual({ ok: false, error: { kind: "server" } });
  });
  it("maps 404, 422 with fields and network failures", async () => {
    expect(await setup({ error: { code: "TripNotFoundError", message: "x" } }, 404).api.reserve(tripId, files)).toEqual({ ok: false, error: { kind: "not-found" } });
    const fields = [{ field: "files[1].sizeBytes", code: "too_large", message: "m" }];
    expect(await setup({ error: { code: "ValidationError", message: "x", fields } }, 422).api.reserve(tripId, files))
      .toEqual({ ok: false, error: { kind: "validation", fields } });
    const client = createHttpClient({ baseUrl: "https://api.test", fetch: vi.fn().mockRejectedValue(new Error("down")), getAccessToken: async () => "t", onUnauthorized: vi.fn() });
    expect(await createTripPhotoApi(client).reserve(tripId, files)).toEqual({ ok: false, error: { kind: "network" } });
  });
});

describe("published photos count adapter", () => {
  const record = (n: number) => ({ id: itineraryId(n), url: `https://bucket.s3.test/p${n}?sig=secret`, order: n });
  it("reads the post's photos path and returns only the amount", async () => {
    const { api, fetch } = setup({ photos: [record(1), record(2), record(3)] }, 200);
    const result = await api.countForPost(tripId, itineraryId(9));
    expect(fetch.mock.calls[0][0]).toBe(`https://api.test/trips/${tripId}/posts/${itineraryId(9)}/photos`);
    expect(fetch.mock.calls[0][1].method).toBe("GET");
    expect(result).toEqual({ ok: true, value: 3 });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("counts none and one", async () => {
    expect(await setup({ photos: [] }, 200).api.countForPost(tripId, itineraryId(9))).toEqual({ ok: true, value: 0 });
    expect(await setup({ photos: [record(1)] }, 200).api.countForPost(tripId, itineraryId(9))).toEqual({ ok: true, value: 1 });
  });
  it("rejects a malformed body or an invalid id as a server failure", async () => {
    for (const body of [{}, { photos: "x" }, { photos: [record(1), "x"] }, { photos: [{ ...record(1), id: "nope" }] }, { photos: [{ url: "x" }] }, null])
      expect(await setup(body, 200).api.countForPost(tripId, itineraryId(9)), JSON.stringify(body)).toEqual({ ok: false, error: { kind: "server" } });
  });
  it("maps HTTP errors", async () => {
    expect(await setup({ error: { code: "PostNotFoundError", message: "x" } }, 404).api.countForPost(tripId, itineraryId(9))).toEqual({ ok: false, error: { kind: "not-found" } });
  });
});

describe("published photos of a post", () => {
  const postId = itineraryId(2);
  const photo = (n: number, extra: Record<string, unknown> = {}) => ({ id: itineraryId(n), order: n, url: `https://cdn.test/p${n}?sig=x`, ...extra });
  it("lists id, order and url sorted by order, from the post's photos path", async () => {
    const { api, fetch } = setup({ photos: [photo(7), photo(3)] }, 200);
    expect(await api.listForPost(tripId, postId)).toEqual({ ok: true, value: [
      { id: itineraryId(3), order: 3, url: "https://cdn.test/p3?sig=x" }, { id: itineraryId(7), order: 7, url: "https://cdn.test/p7?sig=x" }] });
    expect(fetch.mock.calls[0][0]).toBe(`https://api.test/trips/${tripId}/posts/${postId}/photos`);
  });
  it("drops an unusable url but keeps the photo", async () => {
    const { api } = setup({ photos: [photo(3, { url: "http://x.test/a" }), photo(4, { url: undefined })] }, 200);
    expect(await api.listForPost(tripId, postId)).toEqual({ ok: true, value: [{ id: itineraryId(3), order: 3 }, { id: itineraryId(4), order: 4 }] });
  });
  it("is a server failure for a malformed list", async () => {
    for (const body of [{}, { photos: "x" }, { photos: [{ id: "bad", order: 1 }] }, { photos: [{ id: itineraryId(3), order: "x" }] }]) {
      expect(await setup(body, 200).api.listForPost(tripId, postId)).toEqual({ ok: false, error: { kind: "server" } });
    }
  });
  it("still counts", async () => {
    expect(await setup({ photos: [photo(3), photo(4)] }, 200).api.countForPost(tripId, postId)).toEqual({ ok: true, value: 2 });
  });
});
