import { describe, expect, it, vi } from "vitest";
import { createHttpClient } from "../api/index.js";
import { itineraryId } from "./itinerary-test-fixture.js";
import { createTripCommentApi, type CommentResponse } from "./trip-comment-api.js";

const tripId = itineraryId(1), postId = itineraryId(2);
const comment = (n = 5, extra: Record<string, unknown> = {}): CommentResponse => ({ id: itineraryId(n), tripId, postId, authorId: itineraryId(20), text: "Hola",
  createdAt: "2026-09-25T10:00:00.123Z", authorIsFormerMember: false, ...extra } as CommentResponse);
const setup = (body: unknown, status = 200) => {
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status }));
  const client = createHttpClient({ baseUrl: "https://api.test", fetch, getAccessToken: async () => "token", onUnauthorized: vi.fn() });
  return { api: createTripCommentApi(client), fetch };
};
const sent = (fetch: ReturnType<typeof vi.fn>) => ({ url: fetch.mock.calls[0][0] as string, method: fetch.mock.calls[0][1].method as string,
  body: fetch.mock.calls[0][1].body === undefined ? undefined : JSON.parse(fetch.mock.calls[0][1].body) });
const base = `https://api.test/trips/${tripId}/posts/${postId}/comments`;
const failure = (code: string, _status: number, fields?: unknown) => ({ error: { code, message: "x", ...(fields ? { fields } : {}) } });

describe("comment HTTP adapter: list", () => {
  it("requests the comments of the post and keeps the server data", async () => {
    const { api, fetch } = setup({ comments: [comment(5)] });
    expect(await api.list(tripId, postId)).toEqual({ ok: true, value: [comment(5)] });
    expect(sent(fetch)).toEqual({ url: base, method: "GET", body: undefined });
  });
  it("accepts an empty list", async () => {
    expect(await setup({ comments: [] }).api.list(tripId, postId)).toEqual({ ok: true, value: [] });
  });
  it("orders ascending by creation date and then by id", async () => {
    const early = comment(9, { createdAt: "2026-09-25T09:00:00.000Z" });
    const a = comment(5), b = comment(6);
    const { api } = setup({ comments: [b, a, early] });
    expect(await api.list(tripId, postId)).toEqual({ ok: true, value: [early, a, b] });
  });
  it.each([
    ["another trip", { tripId: itineraryId(99) }], ["another post", { postId: itineraryId(98) }], ["an invalid id", { id: "abc" }],
    ["an invalid author", { authorId: "x" }], ["a non boolean former flag", { authorIsFormerMember: "false" }], ["a missing former flag", { authorIsFormerMember: undefined }],
    ["an invalid date", { createdAt: "2026-09-25 10:00" }], ["a date without milliseconds", { createdAt: "2026-09-25T10:00:00Z" }], ["a non string text", { text: 5 }],
  ])("answers server for %s", async (_name, extra) => {
    expect(await setup({ comments: [comment(5, extra)] }).api.list(tripId, postId)).toEqual({ ok: false, error: { kind: "server" } });
  });
  it("answers server for a repeated id and for a malformed payload", async () => {
    expect(await setup({ comments: [comment(5), comment(5)] }).api.list(tripId, postId)).toEqual({ ok: false, error: { kind: "server" } });
    expect(await setup({ comments: "x" }).api.list(tripId, postId)).toEqual({ ok: false, error: { kind: "server" } });
    expect(await setup({}).api.list(tripId, postId)).toEqual({ ok: false, error: { kind: "server" } });
  });
  it.each([[401, "unauthorized"], [403, "forbidden"], [404, "not-found"]])("maps %s to %s", async (status, kind) => {
    expect(await setup(failure("X", status), status).api.list(tripId, postId)).toEqual({ ok: false, error: { kind } });
  });
  it("encodes the ids in the path", async () => {
    const { api, fetch } = setup({ comments: [] });
    await api.list("a/b", "c d");
    expect(sent(fetch).url).toBe("https://api.test/trips/a%2Fb/posts/c%20d/comments");
  });
});

describe("comment HTTP adapter: create", () => {
  it("posts exactly the text and returns the stored comment", async () => {
    const { api, fetch } = setup({ comment: comment(5) }, 201);
    expect(await api.create(tripId, postId, "Hola")).toEqual({ ok: true, value: comment(5) });
    expect(sent(fetch)).toEqual({ url: base, method: "POST", body: { text: "Hola" } });
  });
  it("keeps the validation fields of a 422", async () => {
    const fields = [{ field: "text", code: "too_long", message: "Demasiado largo" }];
    const { api } = setup(failure("ValidationError", 422, fields), 422);
    expect(await api.create(tripId, postId, "x")).toEqual({ ok: false, error: { kind: "validation", fields } });
  });
  it.each([[401, "unauthorized"], [403, "forbidden"], [404, "not-found"], [500, "server"]])("maps %s to %s", async (status, kind) => {
    expect(await setup(failure("X", status), status).api.create(tripId, postId, "x")).toEqual({ ok: false, error: { kind } });
  });
  it("answers server for an invalid response and for another post", async () => {
    expect(await setup({ comment: comment(5, { text: null }) }, 201).api.create(tripId, postId, "x")).toEqual({ ok: false, error: { kind: "server" } });
    expect(await setup({ comment: comment(5, { postId: itineraryId(77) }) }, 201).api.create(tripId, postId, "x")).toEqual({ ok: false, error: { kind: "server" } });
    expect(await setup({}, 201).api.create(tripId, postId, "x")).toEqual({ ok: false, error: { kind: "server" } });
  });
  it("reports a network failure", async () => {
    const client = createHttpClient({ baseUrl: "https://api.test", fetch: vi.fn().mockRejectedValue(new Error("down")), getAccessToken: async () => "t", onUnauthorized: vi.fn() });
    expect(await createTripCommentApi(client).create(tripId, postId, "x")).toEqual({ ok: false, error: { kind: "network", code: "NetworkError" } });
  });
});

describe("comment HTTP adapter: update", () => {
  it("patches only the text on the comment path", async () => {
    const { api, fetch } = setup({ comment: comment(5, { text: "Nuevo" }) });
    expect(await api.update(tripId, postId, itineraryId(5), "Nuevo")).toEqual({ ok: true, value: comment(5, { text: "Nuevo" }) });
    expect(sent(fetch)).toEqual({ url: `${base}/${itineraryId(5)}`, method: "PATCH", body: { text: "Nuevo" } });
  });
  it("rejects an answer for a different comment", async () => {
    expect(await setup({ comment: comment(6) }).api.update(tripId, postId, itineraryId(5), "x")).toEqual({ ok: false, error: { kind: "server" } });
  });
  it("tells an unknown comment apart from an unavailable post", async () => {
    const missing = await setup(failure("CommentNotFoundError", 404), 404).api.update(tripId, postId, itineraryId(5), "x");
    expect(missing).toEqual({ ok: false, error: { kind: "not-found", code: "CommentNotFoundError" } });
    const post = await setup(failure("PostNotFoundError", 404), 404).api.update(tripId, postId, itineraryId(5), "x");
    expect(post).toEqual({ ok: false, error: { kind: "not-found" } });
  });
  it("keeps the validation fields and encodes the comment id", async () => {
    const fields = [{ field: "text", code: "required", message: "Falta" }];
    const { api, fetch } = setup(failure("ValidationError", 422, fields), 422);
    expect(await api.update(tripId, postId, "x/y", "")).toEqual({ ok: false, error: { kind: "validation", fields } });
    expect(sent(fetch).url).toBe(`${base}/x%2Fy`);
  });
});

describe("comment HTTP adapter: remove", () => {
  const url = `${base}/${itineraryId(5)}`;
  const noContent = () => {
    const fetch = vi.fn().mockImplementation(async () => new Response(null, { status: 204 }));
    return { fetch, api: createTripCommentApi(createHttpClient({ baseUrl: "https://api.test", fetch, getAccessToken: async () => "token", onUnauthorized: vi.fn() })) };
  };
  it("deletes without a body and answers ok on 204", async () => {
    const { api, fetch } = noContent();
    expect(await api.remove(tripId, postId, itineraryId(5))).toEqual({ ok: true, value: undefined });
    expect(sent(fetch)).toEqual({ url, method: "DELETE", body: undefined });
  });
  it("encodes the ids", async () => {
    const { api, fetch } = noContent();
    await api.remove(tripId, postId, "x y");
    expect(fetch.mock.calls[0][0]).toBe(`${base}/x%20y`);
  });
  it("keeps the code of a missing comment", async () => {
    expect(await setup(failure("CommentNotFoundError", 404), 404).api.remove(tripId, postId, itineraryId(5)))
      .toEqual({ ok: false, error: { kind: "not-found", code: "CommentNotFoundError" } });
  });
  it("maps 403 and a network failure", async () => {
    expect(await setup(failure("Forbidden", 403), 403).api.remove(tripId, postId, itineraryId(5))).toEqual({ ok: false, error: { kind: "forbidden" } });
    const fetch = vi.fn().mockRejectedValue(new TypeError("net"));
    const api = createTripCommentApi(createHttpClient({ baseUrl: "https://api.test", fetch, getAccessToken: async () => "token", onUnauthorized: vi.fn() }));
    expect(await api.remove(tripId, postId, itineraryId(5))).toEqual({ ok: false, error: { kind: "network", code: "NetworkError" } });
  });
});
