import { describe, expect, it, vi } from "vitest";
import { createHttpClient } from "../api/index.js";
import { itineraryId } from "./itinerary-test-fixture.js";
import { createTripLikeApi } from "./trip-like-api.js";

const tripId = itineraryId(1), postId = itineraryId(2), commentId = itineraryId(5);
const setup = (body: unknown, status = 200) => {
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status }));
  const client = createHttpClient({ baseUrl: "https://api.test", fetch, getAccessToken: async () => "token", onUnauthorized: vi.fn() });
  return { api: createTripLikeApi(client), fetch };
};
const sent = (fetch: ReturnType<typeof vi.fn>) => ({ url: fetch.mock.calls[0][0] as string, method: fetch.mock.calls[0][1].method as string, body: fetch.mock.calls[0][1].body as unknown });
const postUrl = `https://api.test/trips/${tripId}/posts/${postId}/like`;
const commentUrl = `https://api.test/trips/${tripId}/posts/${postId}/comments/${commentId}/like`;
const err = (code: string) => ({ error: { code, message: "x" } });
const server = { ok: false, error: { kind: "server" } };

describe("like HTTP adapter: post and comment likes", () => {
  it("likes a post with PUT and no body, returning what the server says", async () => {
    const { api, fetch } = setup({ like: { liked: true, count: 3 } });
    expect(await api.setPostLike(tripId, postId, true)).toEqual({ ok: true, value: { liked: true, count: 3 } });
    expect(sent(fetch)).toEqual({ url: postUrl, method: "PUT", body: undefined });
  });
  it("removes a post like with DELETE and no body", async () => {
    const { api, fetch } = setup({ like: { liked: false, count: 2 } });
    expect(await api.setPostLike(tripId, postId, false)).toEqual({ ok: true, value: { liked: false, count: 2 } });
    expect(sent(fetch)).toEqual({ url: postUrl, method: "DELETE", body: undefined });
  });
  it("likes and unlikes a comment on its own route", async () => {
    const put = setup({ like: { liked: true, count: 1 } });
    expect(await put.api.setCommentLike(tripId, postId, commentId, true)).toEqual({ ok: true, value: { liked: true, count: 1 } });
    expect(sent(put.fetch)).toEqual({ url: commentUrl, method: "PUT", body: undefined });
    const del = setup({ like: { liked: false, count: 0 } });
    expect(await del.api.setCommentLike(tripId, postId, commentId, false)).toEqual({ ok: true, value: { liked: false, count: 0 } });
    expect(sent(del.fetch)).toEqual({ url: commentUrl, method: "DELETE", body: undefined });
  });
  it("encodes the ids", async () => {
    const { api, fetch } = setup({ like: { liked: false, count: 0 } });
    await api.setCommentLike("a/b", "c d", "e#f", false);
    expect(sent(fetch).url).toBe("https://api.test/trips/a%2Fb/posts/c%20d/comments/e%23f/like");
  });
  it.each([
    ["a negative count", { liked: false, count: -1 }], ["a fractional count", { liked: false, count: 1.5 }], ["a text count", { liked: false, count: "1" }],
    ["a non finite count", { liked: false, count: null }], ["a non boolean liked", { liked: "yes", count: 1 }], ["a like with no count", { liked: true, count: 0 }],
  ])("answers server for %s", async (_name, like) => {
    expect(await setup({ like }).api.setPostLike(tripId, postId, true)).toEqual(server);
    expect(await setup({ like }).api.setCommentLike(tripId, postId, commentId, true)).toEqual(server);
  });
  it("answers server when the like is missing", async () => {
    expect(await setup({}).api.setPostLike(tripId, postId, true)).toEqual(server);
  });
  it.each([[401, "unauthorized"], [403, "forbidden"], [404, "not-found"], [500, "server"]])("maps %s to %s", async (status, kind) => {
    expect(await setup(err("X"), status).api.setPostLike(tripId, postId, true)).toEqual({ ok: false, error: { kind } });
  });
  it("tells an unknown comment apart on a comment like", async () => {
    expect(await setup(err("CommentNotFoundError"), 404).api.setCommentLike(tripId, postId, commentId, true))
      .toEqual({ ok: false, error: { kind: "not-found", code: "CommentNotFoundError" } });
  });
  it("reports a network failure", async () => {
    const client = createHttpClient({ baseUrl: "https://api.test", fetch: vi.fn().mockRejectedValue(new Error("down")), getAccessToken: async () => "t", onUnauthorized: vi.fn() });
    expect(await createTripLikeApi(client).setPostLike(tripId, postId, true)).toEqual({ ok: false, error: { kind: "network" } });
  });
});

describe("like HTTP adapter: summary", () => {
  const summary = { post: { count: 2, likedByMe: true }, comments: [{ commentId, count: 1, likedByMe: false }, { commentId: itineraryId(6), count: 0, likedByMe: false }] };
  it("reads the post and the comments by id", async () => {
    const { api, fetch } = setup(summary);
    expect(await api.summary(tripId, postId)).toEqual({ ok: true, value: { post: { count: 2, likedByMe: true },
      comments: { [commentId]: { count: 1, likedByMe: false }, [itineraryId(6)]: { count: 0, likedByMe: false } } } });
    expect(sent(fetch)).toEqual({ url: `https://api.test/trips/${tripId}/posts/${postId}/likes`, method: "GET", body: undefined });
  });
  it("accepts a summary without comments", async () => {
    expect(await setup({ post: summary.post, comments: [] }).api.summary(tripId, postId)).toEqual({ ok: true, value: { post: summary.post, comments: {} } });
  });
  it("answers server for a repeated comment id", async () => {
    const duplicated = { ...summary, comments: [summary.comments[0], { ...summary.comments[0], count: 5 }] };
    expect(await setup(duplicated).api.summary(tripId, postId)).toEqual(server);
  });
  it.each([
    ["an invalid post count", { post: { count: -1, likedByMe: false }, comments: [] }],
    ["a liked post without count", { post: { count: 0, likedByMe: true }, comments: [] }],
    ["a comment with an invalid id", { post: summary.post, comments: [{ commentId: "zz", count: 0, likedByMe: false }] }],
    ["a comment with a non boolean flag", { post: summary.post, comments: [{ commentId, count: 0, likedByMe: 1 }] }],
    ["missing comments", { post: summary.post }], ["a missing post", { comments: [] }],
  ])("answers server for %s", async (_name, body) => {
    expect(await setup(body).api.summary(tripId, postId)).toEqual(server);
  });
  it.each([[401, "unauthorized"], [403, "forbidden"], [404, "not-found"]])("maps %s to %s", async (status, kind) => {
    expect(await setup(err("X"), status).api.summary(tripId, postId)).toEqual({ ok: false, error: { kind } });
  });
});
