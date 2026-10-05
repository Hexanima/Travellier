import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { SignJWT } from "jose";
import { UnknownError, err } from "app-domain";
import { handleApiRequest } from "../app.js";
import { createLambdaHandler } from "../lambda.js";
import { PostFixture, domainId } from "../../test/post-fixture.js";

describe("post HTTP API", () => {
  const f = new PostFixture();
  beforeAll(() => f.start("post_http"), 120_000);
  afterAll(() => f.stop());
  beforeEach(async () => { vi.restoreAllMocks(); await f.reset(); });
  const input = () => ({ dayId: f.day.toHexString(), description: "Recuerdo" });
  const create = async (fields = {}) => {
    const response = await f.request("POST", f.path(), { ...input(), ...fields });
    expect(response.statusCode, response.body).toBe(201);
    return JSON.parse(response.body).post;
  };
  const links = async () => {
    const parent = await create();
    const activity = await f.api.createActivity!({ ...f.context(), dayId: domainId(f.day), title: "Cena", scheduledAt: f.occurrence });
    if (!activity.ok) throw activity.error;
    const transport = new ObjectId();
    await f.db.collection("transports").insertOne({ _id: transport, tripId: f.trip });
    return { activityId: activity.value.id, parentPostId: parent.id, transportId: transport.toHexString() };
  };

  it.each(["admin", "participant"])("allows %s to create, edit, consult and clear fields preserving server metadata", async (role) => {
    await f.db.collection("tripMembers").updateOne({ tripId: f.trip }, { $set: { role } });
    const post = await create({ authorId: new ObjectId().toHexString(), createdAt: new Date(0).toISOString(), id: new ObjectId().toHexString(), tripId: new ObjectId().toHexString() });
    expect(post).toMatchObject({ tripId: f.trip.toHexString(), authorId: f.actor.toHexString(), activityId: null, parentPostId: null, transportId: null, mapsUrl: null });
    expect(Date.parse(post.createdAt)).toBeGreaterThan(0);
    const response = await f.request("PATCH", `${f.path()}/${post.id}`, { description: null, mapsUrl: "Maps", authorId: new ObjectId().toHexString(), createdAt: new Date(0).toISOString() });
    expect(response.statusCode).toBe(200);
    const edited = { ...post, description: null, mapsUrl: "Maps" };
    expect(JSON.parse(response.body)).toEqual({ post: edited });
    expect(JSON.parse((await f.request("GET", `${f.path()}/${post.id}`)).body)).toEqual({ post: edited });
    expect(JSON.parse((await f.request("GET")).body)).toEqual({ posts: [edited] });
  });

  it.each(Array.from({ length: 8 }, (_, i) => i))("creates combination %i and later links and unlinks independently", async (mask) => {
    const all = await links();
    const selected = { activityId: mask & 1 ? all.activityId : null, parentPostId: mask & 2 ? all.parentPostId : null, transportId: mask & 4 ? all.transportId : null };
    let post = await create(selected);
    expect(post).toMatchObject(selected);
    for (const [field, value] of Object.entries(all)) {
      let response = await f.request("PATCH", `${f.path()}/${post.id}`, { [field]: value });
      expect(response.statusCode).toBe(200); post = { ...post, [field]: value };
      expect(JSON.parse(response.body)).toEqual({ post });
      response = await f.request("PATCH", `${f.path()}/${post.id}`, { [field]: null });
      expect(response.statusCode).toBe(200); post = { ...post, [field]: null };
      expect(JSON.parse(response.body)).toEqual({ post });
    }
  });

  it.each(["activityId", "parentPostId", "transportId"])("invalid %s rejects the entire PATCH and POST without writes", async (field) => {
    const post = await create(await links()), before = await f.snapshot();
    const foreign = new ObjectId(), collection = { activityId: "activities", parentPostId: "posts", transportId: "transports" }[field]!;
    await f.db.collection(collection).insertOne({ _id: foreign, tripId: new ObjectId(), destinationId: new ObjectId(), direction: "outbound" });
    const baseline = await f.snapshot();
    for (const value of [new ObjectId().toHexString(), foreign.toHexString(), "invalid", 42, "", false]) {
      expect((await f.request("PATCH", `${f.path()}/${post.id}`, { description: "No", [field]: value })).statusCode).toBe(422);
      expect(await f.snapshot()).toEqual(baseline);
      expect((await f.request("POST", f.path(), { ...input(), [field]: value })).statusCode).toBe(422);
      expect(await f.snapshot()).toEqual(baseline);
    }
    expect((await f.request("GET", `${f.path()}/${post.id}`)).statusCode).toBe(200);
    expect(baseline[0]).toEqual(before[0]);
  });

  it("rejects self-reference and foreign days without modifying the post", async () => {
    const post = await create(), before = await f.snapshot(), foreign = new ObjectId();
    await f.db.collection("itineraryDays").insertOne({ _id: foreign, tripId: new ObjectId() });
    for (const patch of [{ parentPostId: post.id }, { dayId: foreign.toHexString() }, { dayId: null }, { dayId: new ObjectId().toHexString() }, { description: 42 }, { mapsUrl: [] }]) {
      expect((await f.request("PATCH", `${f.path()}/${post.id}`, patch)).statusCode).toBe(422);
      expect(await f.snapshot()).toEqual(before);
    }
  });

  it("returns 400 for malformed route IDs, JSON and empty or protected-only PATCH", async () => {
    const post = await create();
    for (const payload of [{}, { authorId: f.actor.toHexString() }, [], "{", null])
      expect((await f.request("PATCH", `${f.path()}/${post.id}`, payload)).statusCode).toBe(400);
    expect((await f.request("GET", "/trips/invalid/posts")).statusCode).toBe(400);
    expect((await f.request("GET", `${f.path()}/invalid`)).statusCode).toBe(400);
    expect((await f.request("POST", f.path(), {})).statusCode).toBe(422);
  });

  it("hides absent or foreign posts and denies outsiders and revoked members in public Trips", async () => {
    const post = await create(), foreign = new ObjectId();
    await f.db.collection("posts").insertOne({ _id: foreign, tripId: new ObjectId() });
    for (const id of [foreign, new ObjectId()]) for (const method of ["GET", "PATCH"])
      expect((await f.request(method, `${f.path()}/${id}`, { description: "No" })).statusCode).toBe(404);
    const before = await f.snapshot();
    for (const user of [new ObjectId(), f.actor]) {
      if (user === f.actor) await f.db.collection("tripMembers").deleteMany({ tripId: f.trip });
      for (const [method, path, body] of [["GET", f.path()], ["POST", f.path(), input()], ["GET", `${f.path()}/${post.id}`], ["PATCH", `${f.path()}/${post.id}`, { description: "No" }]] as const)
        expect((await f.request(method, path, body, user)).statusCode).toBe(404);
    }
    expect(await f.snapshot()).toEqual(before);
  });

  it("requires valid access JWTs for every route through Lambda", async () => {
    const jwtSecret = "post-test-signing-secret", key = new TextEncoder().encode(jwtSecret);
    const handler = createLambdaHandler({ loadRuntimeConfig: async () => ({ environment: "dev", mongo: { uri: f.server.getUri(), databaseName: f.db.databaseName }, jwtSecret, photoBucketName: "unused" }), createTripApi: async () => f.api });
    const now = Math.floor(Date.now() / 1000);
    const token = (expiry: number, tokenType = "access") => new SignJWT({ tokenType }).setSubject(f.actor.toHexString())
      .setProtectedHeader({ alg: "HS256" }).setExpirationTime(expiry).sign(key);
    for (const jwt of [undefined, "invalid", await token(now - 60), await token(now + 60, "refresh")])
      for (const [method, path] of [["GET", f.path()], ["POST", f.path()], ["GET", `${f.path()}/${new ObjectId()}`], ["PATCH", `${f.path()}/${new ObjectId()}`]])
        expect((await handler({ rawPath: path!, headers: jwt ? { authorization: `Bearer ${jwt}` } : {}, body: JSON.stringify(input()), requestContext: { http: { method: method! } } })).statusCode).toBe(401);
    const response = await handler({ rawPath: f.path(), headers: { authorization: `Bearer ${await token(now + 60)}` }, body: JSON.stringify(input()), requestContext: { http: { method: "POST" } } });
    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body).post.authorId).toBe(f.actor.toHexString());
  });

  it.each(["2026-09-25T09:00:00.456-03:00", "2026-09-25T12:00:00.456Z"])("creates joint activity at %s and exposes both in itinerary", async (scheduledAt) => {
    const response = await f.request("POST", f.path(), { ...input(), newActivity: { title: "Cena", scheduledAt } });
    expect(response.statusCode, response.body).toBe(201);
    const { post, activity } = JSON.parse(response.body);
    expect(post.activityId).toBe(activity.id); expect(activity.scheduledAt).toBe(f.occurrence.toISOString());
    const itinerary = JSON.parse((await f.request("GET", `/trips/${f.trip}/itinerary`)).body).itinerary;
    expect(itinerary.posts).toMatchObject([post]); expect(itinerary.activities).toMatchObject([{ ...activity, postIds: [post.id] }]);
    expect((await f.request("PATCH", `${f.path()}/${post.id}`, { activityId: null })).statusCode).toBe(200);
    const detached = JSON.parse((await f.request("GET", `/trips/${f.trip}/itinerary`)).body).itinerary;
    expect(detached.activities[0].postIds).toEqual([]); expect(detached.days[0].items).toContainEqual({ kind: "post", id: post.id, at: post.createdAt });
  });

  it.each([undefined, null, "", "invalid", "2026-09-25", "2026-09-25T12:00:00", "2026-02-30T12:00:00Z", "2026-09-25T24:00:00Z", "2026-09-25T12:00:00.4567Z", "2026-09-25T09:00:00Z"])("rejects invalid joint activity time %s without creating anything", async (scheduledAt) => {
    const before = await f.snapshot();
    expect((await f.request("POST", f.path(), { ...input(), newActivity: { title: "Cena", scheduledAt } })).statusCode).toBe(422);
    expect(await f.snapshot()).toEqual(before);
  });

  it("rejects malformed or ambiguous newActivity payloads", async () => {
    const before = await f.snapshot();
    for (const newActivity of [null, [], "Cena", {}, { title: " " }, { title: "Cena", scheduledAt: f.occurrence.toISOString(), mapsUrl: 42 }])
      expect((await f.request("POST", f.path(), { ...input(), newActivity })).statusCode).toBe(422);
    expect((await f.request("POST", f.path(), { ...input(), activityId: new ObjectId().toHexString(), newActivity: { title: "Cena", scheduledAt: f.occurrence.toISOString() } })).statusCode).toBe(422);
    expect(await f.snapshot()).toEqual(before);
  });

  it("reflects transport and parent links and preserves post content when its activity is deleted", async () => {
    const transport = await f.configureTransports(), parent = await create();
    const response = await f.request("POST", f.path(), { ...input(), transportId: transport.id, parentPostId: parent.id,
      newActivity: { title: "Cena", scheduledAt: f.occurrence.toISOString() } });
    expect(response.statusCode).toBe(201); const { post, activity } = JSON.parse(response.body);
    const itinerary = JSON.parse((await f.request("GET", `/trips/${f.trip}/itinerary`)).body).itinerary;
    expect(itinerary.transports.find((t: { id: string }) => t.id === transport.id).postIds).toContain(post.id);
    expect(itinerary.posts.find((p: { id: string }) => p.id === post.id).parentPostId).toBe(parent.id);
    expect((await f.request("DELETE", `/trips/${f.trip}/activities/${activity.id}`)).statusCode).toBe(204);
    expect(JSON.parse((await f.request("GET", `${f.path()}/${post.id}`)).body)).toEqual({ post: { ...post, activityId: null } });
  });

  it("returns 503 for unavailable dependencies and generic 500 for persistence errors", async () => {
    expect((await handleApiRequest({ method: "GET", url: f.path(), authenticatedUserId: domainId(f.actor) })).statusCode).toBe(503);
    expect(f.api.createPost).toBeTypeOf("function");
    f.api.createPost = async () => err(new UnknownError("secret detail"));
    const response = await f.request("POST", f.path(), input());
    expect(response.statusCode).toBe(500); expect(response.body).not.toContain("secret detail");
  });
});
