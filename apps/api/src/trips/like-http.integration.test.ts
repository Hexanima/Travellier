import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { AddressInfo } from "node:net";
import { handleApiRequest, createApp } from "../app.js";
import { PostFixture, domainId } from "../../test/post-fixture.js";

describe("like HTTP API", () => {
  const f = new PostFixture();
  beforeAll(() => f.start("like_http"), 120_000);
  afterAll(() => f.stop());
  beforeEach(async () => { vi.restoreAllMocks(); await f.reset(); });
  let postId = "", commentId = "";
  const seed = async () => {
    const created = await f.request("POST", f.path(), { description: "Recuerdo" });
    expect(created.statusCode, created.body).toBe(201);
    postId = JSON.parse(created.body).post.id;
    const response = await f.request("POST", `${f.path()}/${postId}/comments`, { text: "Hola" });
    expect(response.statusCode, response.body).toBe(201);
    commentId = JSON.parse(response.body).comment.id;
  };
  beforeEach(seed);
  const postUrl = (post = postId, trip = f.trip.toHexString()) => `/trips/${trip}/posts/${post}/like`;
  const commentUrl = (comment = commentId, post = postId, trip = f.trip.toHexString()) => `/trips/${trip}/posts/${post}/comments/${comment}/like`;
  const readUrl = (post = postId, trip = f.trip.toHexString()) => `/trips/${trip}/posts/${post}/likes`;
  const body = (response: { body: string }) => JSON.parse(response.body);
  const addMember = async (role: "admin" | "participant" = "participant") => {
    const userId = new ObjectId();
    await f.db.collection("tripMembers").insertOne({ tripId: f.trip, userId, role, joinedAt: new Date() });
    return userId;
  };
  const rows = () => Promise.all([f.db.collection("postLikes").countDocuments({}), f.db.collection("commentLikes").countDocuments({})]);

  it("PUT and DELETE a post like answer 200 with exactly {like:{liked,count}}, also when repeated", async () => {
    const expected = [[true, 1], [true, 1], [false, 0], [false, 0]];
    const seen: unknown[] = [];
    for (const method of ["PUT", "PUT", "DELETE", "DELETE"]) {
      const response = await f.request(method, postUrl());
      expect(response.statusCode, response.body).toBe(200);
      expect(Object.keys(body(response))).toEqual(["like"]);
      expect(Object.keys(body(response).like).sort()).toEqual(["count", "liked"]);
      seen.push([body(response).like.liked, body(response).like.count]);
    }
    expect(seen).toEqual(expected);
  });

  it("PUT and DELETE a comment like answer 200 with exactly {like:{liked,count}}, also when repeated", async () => {
    const seen: unknown[] = [];
    for (const method of ["PUT", "PUT", "DELETE", "DELETE"]) {
      const response = await f.request(method, commentUrl());
      expect(response.statusCode, response.body).toBe(200);
      expect(Object.keys(body(response))).toEqual(["like"]);
      seen.push(body(response).like);
    }
    expect(seen).toEqual([{ liked: true, count: 1 }, { liked: true, count: 1 }, { liked: false, count: 0 }, { liked: false, count: 0 }]);
  });

  it("ignores identity fields in the body and does not require one", async () => {
    const other = new ObjectId();
    const forged = { userId: other.toHexString(), tripId: new ObjectId().toHexString(), createdAt: new Date(0).toISOString(), id: other.toHexString() };
    expect((await f.request("PUT", postUrl(), forged)).statusCode).toBe(200);
    expect((await f.request("PUT", commentUrl(), forged)).statusCode).toBe(200);
    expect((await f.request("PUT", postUrl(), "{bad")).statusCode).toBe(200);
    const stored = await f.db.collection("postLikes").find({}).toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ userId: f.actor, tripId: f.trip, postId: new ObjectId(postId) });
    expect(stored[0]!.createdAt.getTime()).toBeGreaterThan(Date.parse("2020-01-01"));
    expect(await f.db.collection("commentLikes").find({}).toArray()).toMatchObject([{ userId: f.actor, tripId: f.trip }]);
  });

  it("returns 401 without a user on the five routes", async () => {
    const calls: Array<[string, string]> = [["PUT", postUrl()], ["DELETE", postUrl()], ["PUT", commentUrl()], ["DELETE", commentUrl()], ["GET", readUrl()]];
    for (const [method, url] of calls) expect((await handleApiRequest({ method, url }, { trips: f.api })).statusCode, `${method} ${url}`).toBe(401);
    expect(await rows()).toEqual([0, 0]);
  });

  it("returns 400 for invalid ids", async () => {
    for (const [method, url] of [["PUT", postUrl("nope")], ["DELETE", postUrl(postId, "nope")], ["PUT", commentUrl("nope")], ["DELETE", commentUrl(commentId, "nope")],
      ["PUT", commentUrl(commentId, "nope")], ["GET", readUrl("nope")], ["GET", readUrl(postId, "nope")]] as const) {
      expect((await f.request(method, url)).statusCode, `${method} ${url}`).toBe(400);
    }
    expect(await rows()).toEqual([0, 0]);
  });

  it("returns 404 TripNotFoundError for a non-member, an unknown Trip and a former member", async () => {
    const stranger = new ObjectId(), admin = await addMember("admin");
    await f.request("PUT", postUrl());
    const calls = (trip: string) => [["PUT", postUrl(postId, trip)], ["DELETE", postUrl(postId, trip)], ["PUT", commentUrl(commentId, postId, trip)],
      ["DELETE", commentUrl(commentId, postId, trip)], ["GET", readUrl(postId, trip)]] as const;
    for (const [method, url] of calls(f.trip.toHexString())) {
      const response = await f.request(method, url, undefined, stranger);
      expect([response.statusCode, body(response).error.code], `${method} ${url}`).toEqual([404, "TripNotFoundError"]);
    }
    for (const [method, url] of calls(new ObjectId().toHexString())) {
      const response = await f.request(method, url);
      expect([response.statusCode, body(response).error.code], `${method} ${url}`).toEqual([404, "TripNotFoundError"]);
    }
    expect((await f.api.expelMember!({ tripId: domainId(f.trip), actorUserId: domainId(admin), targetUserId: domainId(f.actor) })).ok).toBe(true);
    for (const [method, url] of calls(f.trip.toHexString())) {
      const response = await f.request(method, url);
      expect([response.statusCode, body(response).error.code], `${method} ${url}`).toEqual([404, "TripNotFoundError"]);
    }
    expect(await rows()).toEqual([1, 0]);
  });

  it("returns 404 PostNotFoundError and CommentNotFoundError for entities that are not of that Trip or post", async () => {
    const tripB = new ObjectId(), actorB = new ObjectId();
    await f.db.collection("trips").insertOne({ _id: tripB, inviteCode: tripB.toHexString(), visibility: "public", votingEnabled: false, expenseMode: "register" });
    await f.db.collection("tripMembers").insertOne({ tripId: tripB, userId: actorB, role: "participant", joinedAt: new Date() });
    const postB = body(await f.request("POST", `/trips/${tripB}/posts`, { description: "B" }, actorB)).post.id;
    const commentB = body(await f.request("POST", `/trips/${tripB}/posts/${postB}/comments`, { text: "B" }, actorB)).comment.id;
    const otherPost = body(await f.request("POST", f.path(), { description: "Otro" })).post.id;
    const missingPost = new ObjectId().toHexString();
    for (const [method, url] of [["PUT", postUrl(postB)], ["DELETE", postUrl(missingPost)], ["PUT", commentUrl(commentId, postB)],
      ["GET", readUrl(postB)], ["GET", readUrl(missingPost)]] as const) {
      const response = await f.request(method, url);
      expect([response.statusCode, body(response).error.code], `${method} ${url}`).toEqual([404, "PostNotFoundError"]);
    }
    for (const url of [commentUrl(commentB), commentUrl(new ObjectId().toHexString()), commentUrl(commentId, otherPost)]) {
      for (const method of ["PUT", "DELETE"]) {
        const response = await f.request(method, url);
        expect([response.statusCode, body(response).error.code], `${method} ${url}`).toEqual([404, "CommentNotFoundError"]);
      }
    }
    expect(await rows()).toEqual([0, 0]);
  });

  it("GET reports likedByMe per user and counts likes of former members", async () => {
    const other = await addMember("admin"), third = await addMember();
    await f.request("PUT", postUrl()); await f.request("PUT", postUrl(), undefined, other);
    await f.request("PUT", commentUrl(), undefined, other); await f.request("PUT", commentUrl());
    expect((await f.api.expelMember!({ tripId: domainId(f.trip), actorUserId: domainId(other), targetUserId: domainId(f.actor) })).ok).toBe(true);
    const asOther = await f.request("GET", readUrl(), undefined, other);
    expect(asOther.statusCode, asOther.body).toBe(200);
    expect(body(asOther)).toEqual({ post: { count: 2, likedByMe: true }, comments: [{ commentId, count: 2, likedByMe: true }] });
    expect(Object.keys(body(asOther))).toEqual(["post", "comments"]);
    const asThird = await f.request("GET", readUrl(), undefined, third);
    expect(body(asThird)).toEqual({ post: { count: 2, likedByMe: false }, comments: [{ commentId, count: 2, likedByMe: false }] });
    expect((await f.request("GET", readUrl())).statusCode).toBe(404);
  });

  it("does not write on unsupported methods", async () => {
    for (const method of ["POST", "PATCH", "GET"]) {
      for (const url of [postUrl(), commentUrl()]) {
        expect([404, 405], `${method} ${url}`).toContain((await f.request(method, url)).statusCode);
      }
    }
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) expect([404, 405], method).toContain((await f.request(method, readUrl())).statusCode);
    expect(await rows()).toEqual([0, 0]);
  });

  it("does not shadow the existing post and comment routes", async () => {
    expect((await f.request("GET", `${f.path()}/${postId}`)).statusCode).toBe(200);
    expect((await f.request("GET", `${f.path()}/${postId}/comments`)).statusCode).toBe(200);
    expect((await f.request("PATCH", `${f.path()}/${postId}/comments/${commentId}`, { text: "Nuevo" })).statusCode).toBe(200);
  });

  it("returns 503 when trips is not configured", async () => {
    for (const [method, url] of [["PUT", postUrl()], ["DELETE", postUrl()], ["PUT", commentUrl()], ["DELETE", commentUrl()], ["GET", readUrl()]] as const) {
      expect((await handleApiRequest({ method, url, authenticatedUserId: domainId(f.actor) })).statusCode, `${method} ${url}`).toBe(503);
    }
  });

  it("is not blocked by CORS or the server handler for PUT and DELETE", async () => {
    const origin = "http://localhost:5173";
    const server = createApp({ trips: f.api }, async () => ({ authenticatedUserId: domainId(f.actor) }) as never);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      for (const method of ["PUT", "DELETE"]) {
        const preflight = await fetch(`${base}${postUrl()}`, { method: "OPTIONS", headers: { origin, "access-control-request-method": method } });
        expect(preflight.status).toBe(204);
        expect(preflight.headers.get("access-control-allow-methods")).toContain(method);
      }
      const put = await fetch(`${base}${postUrl()}`, { method: "PUT", headers: { origin, authorization: "Bearer token" } });
      expect(put.status).toBe(200);
      expect(await put.json()).toEqual({ like: { liked: true, count: 1 } });
      const del = await fetch(`${base}${commentUrl()}`, { method: "DELETE", headers: { origin, authorization: "Bearer token" } });
      expect(del.status).toBe(200);
      expect(await del.json()).toEqual({ like: { liked: false, count: 0 } });
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
