import { describe, expect, it, vi } from "vitest";
import { createHttpClient } from "../api/index.js";
import { itineraryId } from "./itinerary-test-fixture.js";
import { createTripGalleryApi } from "./trip-gallery-api.js";

const tripId = itineraryId(1);
const photo = (n: number, extra: Record<string, unknown> = {}) => ({
  id: itineraryId(100 + n), postId: itineraryId(200 + n), order: 0, uploadedAt: "2026-11-10T10:00:00.000Z", uploaderId: itineraryId(300 + n),
  url: `https://bucket.s3.test/p${n}?sig=SECRET${n}`, expiresAt: "2026-11-10T12:05:00.000Z",
  post: { createdAt: "2026-11-10T09:00:00.000Z", authorId: itineraryId(400 + n), rootActivityId: null, rootTransportId: null }, ...extra,
});
const setup = (body: unknown, status = 200) => {
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status }));
  const client = createHttpClient({ baseUrl: "https://api.test", fetch, getAccessToken: async () => "token", onUnauthorized: vi.fn() });
  return { api: createTripGalleryApi(client), fetch };
};
const failure = (kind: string, extra: Record<string, unknown> = {}) => ({ ok: false, error: { kind, ...extra } });

describe("trip gallery adapter", () => {
  it("builds the path with the encoded query and omits what is undefined", async () => {
    const { api, fetch } = setup({ photos: [], nextCursor: null });
    await api.list(tripId, { limit: 10, cursor: "a+b/c=", activityId: itineraryId(5), transportId: itineraryId(6) });
    expect(fetch.mock.calls[0][0]).toBe(`https://api.test/trips/${tripId}/photos?limit=10&cursor=a%2Bb%2Fc%3D&activityId=${itineraryId(5)}&transportId=${itineraryId(6)}`);
    expect(fetch.mock.calls[0][1].method).toBe("GET");
    await api.list(tripId, {});
    expect(fetch.mock.calls[1][0]).toBe(`https://api.test/trips/${tripId}/photos`);
    await api.list(tripId, { cursor: undefined, limit: 30 });
    expect(fetch.mock.calls[2][0]).toBe(`https://api.test/trips/${tripId}/photos?limit=30`);
  });
  it("parses a valid page, keeping the server order and the expiry in milliseconds", async () => {
    const { api } = setup({ photos: [photo(2), photo(1, { post: { createdAt: "2026-11-10T09:00:00.000Z", authorId: itineraryId(1), rootActivityId: itineraryId(9), rootTransportId: itineraryId(8) } })], nextCursor: "next" });
    const result = await api.list(tripId, {});
    expect(result.ok && result.value.nextCursor).toBe("next");
    expect(result).toEqual({ ok: true, value: { nextCursor: "next", photos: [
      { id: itineraryId(102), postId: itineraryId(202), order: 0, uploadedAt: "2026-11-10T10:00:00.000Z", uploaderId: itineraryId(302), url: "https://bucket.s3.test/p2?sig=SECRET2",
        expiresAtMs: Date.parse("2026-11-10T12:05:00.000Z"), post: { createdAt: "2026-11-10T09:00:00.000Z", authorId: itineraryId(402), rootActivityId: null, rootTransportId: null } },
      { id: itineraryId(101), postId: itineraryId(201), order: 0, uploadedAt: "2026-11-10T10:00:00.000Z", uploaderId: itineraryId(301), url: "https://bucket.s3.test/p1?sig=SECRET1",
        expiresAtMs: Date.parse("2026-11-10T12:05:00.000Z"), post: { createdAt: "2026-11-10T09:00:00.000Z", authorId: itineraryId(1), rootActivityId: itineraryId(9), rootTransportId: itineraryId(8) } }] } });
  });
  it("rejects any other shape as a server failure", async () => {
    const bad: Record<string, unknown>[] = [
      { url: "http://bucket.s3.test/p" }, { url: "https://user:pw@bucket.s3.test/p" }, { url: "no url" }, { url: 5 }, { id: "xyz" }, { postId: "xyz" }, { uploaderId: 3 },
      { order: -1 }, { order: 1.5 }, { order: "0" }, { uploadedAt: "ayer" }, { expiresAt: "ayer" }, { expiresAt: 5 },
      { post: null }, { post: { createdAt: "x", authorId: itineraryId(1), rootActivityId: null, rootTransportId: null } },
      { post: { createdAt: "2026-11-10T09:00:00.000Z", authorId: "x", rootActivityId: null, rootTransportId: null } },
      { post: { createdAt: "2026-11-10T09:00:00.000Z", authorId: itineraryId(1), rootActivityId: "x", rootTransportId: null } },
      { post: { createdAt: "2026-11-10T09:00:00.000Z", authorId: itineraryId(1), rootActivityId: null } },
    ];
    for (const extra of bad) expect((await setup({ photos: [photo(1, extra)], nextCursor: null }).api.list(tripId, {})), JSON.stringify(extra)).toEqual(failure("server"));
    for (const nextCursor of ["", 5, undefined]) expect(await setup({ photos: [], nextCursor }).api.list(tripId, {}), String(nextCursor)).toEqual(failure("server"));
    expect(await setup({ photos: [photo(1), photo(1)], nextCursor: null }).api.list(tripId, {})).toEqual(failure("server"));
    expect(await setup({ photos: Array.from({ length: 61 }, (_, n) => photo(n)), nextCursor: null }).api.list(tripId, {})).toEqual(failure("server"));
    expect(await setup({ photos: Array.from({ length: 60 }, (_, n) => photo(n)), nextCursor: null }).api.list(tripId, {})).toMatchObject({ ok: true });
    expect(await setup({ photos: "x", nextCursor: null }).api.list(tripId, {})).toEqual(failure("server"));
    expect(await setup([]).api.list(tripId, {})).toEqual(failure("server"));
  });
  it("ignores and does not copy extra fields", async () => {
    const result = await setup({ photos: [photo(1, { secret: "x", post: { ...photo(1).post, text: "y" } })], nextCursor: null, total: 3 }).api.list(tripId, {});
    expect(result.ok && Object.keys(result.value)).toEqual(["photos", "nextCursor"]);
    expect(result.ok && Object.keys(result.value.photos[0]!).sort()).toEqual(["expiresAtMs", "id", "order", "post", "postId", "uploadedAt", "uploaderId", "url"]);
    expect(result.ok && Object.keys(result.value.photos[0]!.post).sort()).toEqual(["authorId", "createdAt", "rootActivityId", "rootTransportId"]);
  });
  it("maps the API errors and never carries the URL", async () => {
    expect(await setup({ error: { code: "TripNotFoundError", message: "x" } }, 404).api.list(tripId, {})).toEqual(failure("not-found"));
    expect(await setup({ error: { code: "ValidationError", message: "x", fields: [{ field: "cursor", code: "invalid", message: "m" }] } }, 422).api.list(tripId, {}))
      .toEqual(failure("validation", { fields: [{ field: "cursor", code: "invalid", message: "m" }] }));
    expect(await setup({}, 401).api.list(tripId, {})).toEqual(failure("unauthorized"));
    expect(await setup({}, 503).api.list(tripId, {})).toEqual(failure("server"));
    const fetch = vi.fn().mockRejectedValue(new TypeError("offline"));
    const api = createTripGalleryApi(createHttpClient({ baseUrl: "https://api.test", fetch, getAccessToken: async () => "t", onUnauthorized: vi.fn() }));
    expect(await api.list(tripId, {})).toEqual(failure("network"));
    const bad = await setup({ photos: [photo(1, { url: "http://bucket.s3.test/p?sig=SECRET1" })], nextCursor: null }).api.list(tripId, {});
    expect(JSON.stringify(bad)).not.toContain("SECRET");
  });
});
