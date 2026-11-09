import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { handleApiRequest } from "../app.js";
import { PostFixture, domainId } from "../../test/post-fixture.js";

describe("comment HTTP API", () => {
  const f = new PostFixture();
  beforeAll(() => f.start("comment_http"), 120_000);
  afterAll(() => f.stop());
  beforeEach(async () => { vi.restoreAllMocks(); await f.reset(); });
  let postId = "";
  const path = (post = postId, trip = f.trip.toHexString()) => `/trips/${trip}/posts/${post}/comments`;
  const seedPost = async () => {
    const response = await f.request("POST", f.path(), { description: "Recuerdo" });
    expect(response.statusCode, response.body).toBe(201);
    postId = JSON.parse(response.body).post.id;
  };
  beforeEach(seedPost);
  const post = async (fields: unknown = { text: "Hola" }, url = path(), user = f.actor) => f.request("POST", url, fields, user);
  const body = (response: { body: string }) => JSON.parse(response.body);

  it("creates with 201 and ignores identity fields supplied by the client", async () => {
    const response = await post({ text: "  Hola  ", authorId: new ObjectId().toHexString(), createdAt: new Date(0).toISOString(),
      tripId: new ObjectId().toHexString(), postId: new ObjectId().toHexString(), id: new ObjectId().toHexString() });
    expect(response.statusCode, response.body).toBe(201);
    const { comment } = body(response);
    expect(comment).toMatchObject({ tripId: f.trip.toHexString(), postId, authorId: f.actor.toHexString(), text: "Hola", authorIsFormerMember: false });
    expect(Date.parse(comment.createdAt)).toBeGreaterThan(Date.parse("2020-01-01"));
    expect(Object.keys(comment).sort()).toEqual(["authorId", "authorIsFormerMember", "createdAt", "id", "postId", "text", "tripId"]);
    expect(await f.db.collection("comments").countDocuments({ tripId: f.trip })).toBe(1);
  });

  it("lists in creation order and edits keeping author and date", async () => {
    const first = body(await post({ text: "Uno" })).comment;
    await post({ text: "Dos" });
    const editor = new ObjectId(); await f.db.collection("tripMembers").insertOne({ tripId: f.trip, userId: editor, role: "admin", joinedAt: new Date() });
    const edited = await f.request("PATCH", `${path()}/${first.id}`, { text: " Editado ", authorId: new ObjectId().toHexString(), createdAt: new Date(0).toISOString() }, editor);
    expect(edited.statusCode, edited.body).toBe(200);
    expect(body(edited)).toEqual({ comment: { ...first, text: "Editado" } });
    const listed = await f.request("GET", path());
    expect(listed.statusCode).toBe(200);
    expect(body(listed).comments.map((c: { text: string }) => c.text)).toEqual(["Editado", "Dos"]);
    expect(Object.keys(body(listed))).toEqual(["comments"]);
  });

  it("returns 401 without a user", async () => {
    for (const method of ["GET", "POST"]) expect((await handleApiRequest({ method, url: path(), body: { text: "x" } }, { trips: f.api })).statusCode).toBe(401);
    expect((await handleApiRequest({ method: "PATCH", url: `${path()}/${new ObjectId()}`, body: { text: "x" } }, { trips: f.api })).statusCode).toBe(401);
  });

  it("returns 400 for invalid ids, JSON or non-object bodies", async () => {
    expect((await f.request("GET", path("nope"))).statusCode).toBe(400);
    expect((await f.request("GET", path(postId, "nope"))).statusCode).toBe(400);
    expect((await f.request("PATCH", `${path()}/nope`, { text: "x" })).statusCode).toBe(400);
    for (const invalid of ["{bad", "[1]", "null", "5"]) {
      expect((await post(invalid)).statusCode, invalid).toBe(400);
      expect((await f.request("PATCH", `${path()}/${new ObjectId()}`, invalid)).statusCode, invalid).toBe(400);
    }
    expect(await f.db.collection("comments").countDocuments({})).toBe(0);
  });

  it.each([{}, { text: "" }, { text: "   " }, { text: 5 }, { text: null }, { text: "a".repeat(2001) }])("returns 422 on field text for %j", async (fields) => {
    const created = body(await post({ text: "Hola" })).comment;
    for (const response of [await post(fields), await f.request("PATCH", `${path()}/${created.id}`, fields)]) {
      expect(response.statusCode, response.body).toBe(422);
      expect(body(response).error.fields).toHaveLength(1);
      expect(body(response).error.fields[0]).toMatchObject({ field: "text" });
    }
    expect(body(await f.request("GET", path())).comments).toMatchObject([{ text: "Hola" }]);
  });

  it("returns exact 422 codes", async () => {
    const codes = async (text: unknown) => body(await post({ text })).error.fields[0].code;
    expect([await codes(""), await codes(5), await codes("a".repeat(2001))]).toEqual(["required", "invalid", "too_long"]);
    expect((await post({ text: "a".repeat(2000) })).statusCode).toBe(201);
  });

  it("returns 404 for non-members, other Trips, other posts and unknown comments", async () => {
    const created = body(await post()).comment;
    const stranger = new ObjectId();
    for (const response of [await post({ text: "x" }, path(), stranger), await f.request("GET", path(), undefined, stranger),
      await f.request("PATCH", `${path()}/${created.id}`, { text: "x" }, stranger)]) {
      expect(response.statusCode).toBe(404);
      expect(body(response).error.code).toBe("TripNotFoundError");
    }
    expect((await f.request("GET", path(new ObjectId().toHexString()))).statusCode).toBe(404);
    expect((await post({ text: "x" }, path(new ObjectId().toHexString()))).statusCode).toBe(404);
    const other = await f.request("PATCH", `${path(new ObjectId().toHexString())}/${created.id}`, { text: "x" });
    expect([other.statusCode, body(other).error.code]).toEqual([404, "PostNotFoundError"]);
    const missing = await f.request("PATCH", `${path()}/${new ObjectId()}`, { text: "x" });
    expect([missing.statusCode, body(missing).error.code]).toEqual([404, "CommentNotFoundError"]);
    expect(body(await f.request("GET", path())).comments).toMatchObject([{ text: "Hola" }]);
  });

  it("does not let a member of another Trip reach this one", async () => {
    const created = body(await post()).comment;
    const tripB = new ObjectId(), actorB = new ObjectId();
    await f.db.collection("trips").insertOne({ _id: tripB, inviteCode: tripB.toHexString(), visibility: "public", votingEnabled: false, expenseMode: "register" });
    await f.db.collection("tripMembers").insertOne({ tripId: tripB, userId: actorB, role: "participant", joinedAt: new Date() });
    const url = path(postId, f.trip.toHexString());
    for (const response of [await f.request("GET", url, undefined, actorB), await post({ text: "x" }, url, actorB),
      await f.request("PATCH", `${url}/${created.id}`, { text: "x" }, actorB)]) expect(response.statusCode).toBe(404);
    const crossed = await f.request("GET", path(postId, tripB.toHexString()), undefined, actorB);
    expect(crossed.statusCode).toBe(404);
    expect(await f.db.collection("comments").countDocuments({ tripId: f.trip })).toBe(1);
  });

  it("returns 503 when trips is not configured", async () => {
    expect((await handleApiRequest({ method: "GET", url: path(), authenticatedUserId: domainId(f.actor) })).statusCode).toBe(503);
    expect((await handleApiRequest({ method: "POST", url: path(), body: { text: "x" }, authenticatedUserId: domainId(f.actor) })).statusCode).toBe(503);
    expect((await handleApiRequest({ method: "PATCH", url: `${path()}/${new ObjectId()}`, body: { text: "x" }, authenticatedUserId: domainId(f.actor) })).statusCode).toBe(503);
  });

  it("marks a former member's comment on read", async () => {
    await post({ text: "Hola" });
    const admin = new ObjectId(); await f.db.collection("tripMembers").insertOne({ tripId: f.trip, userId: admin, role: "admin", joinedAt: new Date() });
    await f.api.expelMember!({ tripId: domainId(f.trip), actorUserId: domainId(admin), targetUserId: domainId(f.actor) });
    expect(body(await f.request("GET", path(), undefined, admin)).comments).toMatchObject([{ authorId: f.actor.toHexString(), authorIsFormerMember: true }]);
    expect((await f.request("GET", path())).statusCode).toBe(404);
  });
});
