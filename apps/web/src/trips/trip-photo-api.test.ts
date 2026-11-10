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
