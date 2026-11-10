import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { SignJWT } from "jose";
import { createLambdaHandler } from "../lambda.js";
import { handleApiRequest, type ApiResponse } from "../app.js";
import { migrateMongoSchema } from "../adapters/mongodb/migrations.js";
import { createTripApi } from "../trips/trip-api.js";
import { createObjectId } from "app-domain";

const domainId = (value: ObjectId) => {
  const parsed = createObjectId(value.toHexString());
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};

/** `GET /notifications` (T91): the personal notices of the authenticated user, read-only, over a real transactional MongoDB. */
describe("notification inbox HTTP API", () => {
  let server: MongoMemoryReplSet, client: MongoClient, db: Db, api: ReturnType<typeof createTripApi>;
  let trip: ObjectId, day: ObjectId, author: ObjectId, reader: ObjectId, admin: ObjectId;
  const jwtSecret = "notification-inbox-test-secret";
  const occurrence = new Date("2026-09-25T12:00:00.456Z");

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = new MongoClient(server.getUri()); await client.connect();
    db = client.db("notification_http"); await migrateMongoSchema(db);
  }, 120_000);
  afterAll(async () => { await client?.close(); await server?.stop(); });
  beforeEach(async () => {
    for (const name of ["trips", "tripMembers", "destinations", "itineraryDays", "activities", "activityParticipations", "posts", "comments",
      "postLikes", "commentLikes", "outboxEvents", "activityVotes"]) await db.collection(name).deleteMany({});
    trip = new ObjectId(); day = new ObjectId(); author = new ObjectId(); reader = new ObjectId(); admin = new ObjectId();
    const destination = new ObjectId();
    await db.collection("trips").insertOne({ _id: trip, inviteCode: trip.toHexString(), visibility: "public", votingEnabled: false, expenseMode: "register" });
    await db.collection("tripMembers").insertMany([{ tripId: trip, userId: author, role: "participant", joinedAt: new Date() },
      { tripId: trip, userId: reader, role: "participant", joinedAt: new Date() }, { tripId: trip, userId: admin, role: "admin", joinedAt: new Date() }]);
    await db.collection("destinations").insertOne({ _id: destination, tripId: trip, name: "Córdoba", order: 1, createdAt: new Date() });
    await db.collection("itineraryDays").insertOne({ _id: day, tripId: trip, destinationId: destination, type: "activity", order: 1,
      date: new Date("2026-09-25T00:00:00Z"), startsAt: new Date("2026-09-25T10:00:00.123Z"), endsAt: new Date("2026-09-25T18:00:00.789Z") });
    api = createTripApi(db);
  });

  const get = (url: string, user: ObjectId | null = reader, body?: unknown): Promise<ApiResponse> =>
    handleApiRequest({ method: "GET", url, body, ...(user === null ? {} : { authenticatedUserId: domainId(user) }) }, { trips: api });
  const page = async (url = "/notifications", user: ObjectId = reader) => {
    const response = await get(url, user);
    expect(response.statusCode, response.body).toBe(200);
    return JSON.parse(response.body) as { notifications: { id: string; type: string; tripId: string; actorId: string | null; payload: Record<string, unknown>; createdAt: string }[]; nextCursor: string | null };
  };
  const post = async (user: ObjectId, fields: Record<string, unknown> = {}) => {
    const result = await api.createPost!({ tripId: domainId(trip), authenticatedUserId: domainId(user), description: "Recuerdo", ...fields });
    if (!result.ok || result.value.outcome !== "created") throw new Error(JSON.stringify(result));
    return result.value;
  };
  const outboxState = () => db.collection("outboxEvents").find().sort({ _id: 1 }).toArray();

  it("answers 401 without a token and never reads the user from the request", async () => {
    await post(author);
    expect((await get("/notifications", null)).statusCode).toBe(401);
    const forged = await get(`/notifications?userId=${author}`);
    expect(forged.statusCode).toBe(422);
    expect(forged.body).not.toContain(author.toHexString());
    expect((await page("/notifications", reader)).notifications).toHaveLength(1);
    // A body, if any, is ignored: the user is the one of the session.
    const withBody = await get("/notifications", reader, JSON.stringify({ userId: author.toHexString() }));
    expect(JSON.parse(withBody.body).notifications).toHaveLength(1);
  });

  it("goes through the JWT middleware of the Lambda with its query string: the token defines the user and no token is a 401", async () => {
    await post(author); await post(author);
    const handler = createLambdaHandler({
      loadRuntimeConfig: async () => ({ jwtSecret } as never), createTripApi: async () => api,
      createAuthenticationApi: async () => ({}) as never, createPushDeviceApi: async () => ({}) as never,
    });
    const token = await new SignJWT({ tokenType: "access" }).setSubject(reader.toHexString()).setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(Math.floor(Date.now() / 1000) + 60).sign(new TextEncoder().encode(jwtSecret));
    const event = (headers: Record<string, string>, rawQueryString = "") => ({ rawPath: "/notifications", rawQueryString, headers,
      requestContext: { http: { method: "GET" } }, isBase64Encoded: false }) as never;
    const authorized = { authorization: `Bearer ${token}` };
    const first = await handler(event(authorized));
    expect(first).toMatchObject({ statusCode: 200 });
    expect(JSON.parse(first.body).notifications).toHaveLength(2);
    // API Gateway carries the query apart from the path: the Lambda must hand it to the route (pagination).
    const limited = await handler(event(authorized, "limit=1"));
    expect(limited).toMatchObject({ statusCode: 200 });
    const parsed = JSON.parse(limited.body);
    expect(parsed.notifications).toHaveLength(1);
    expect(parsed.nextCursor).toEqual(expect.any(String));
    const next = await handler(event(authorized, `limit=1&cursor=${parsed.nextCursor}`));
    expect(JSON.parse(next.body).notifications.map((n: { id: string }) => n.id)).not.toContain(parsed.notifications[0].id);
    expect(await handler(event({}))).toMatchObject({ statusCode: 401 });
  });

  it("lists only the notices of the authenticated user, with exact ids and no texts", async () => {
    const created = await post(author, { description: "Secreto del viaje", newActivity: { title: "Cena privada", scheduledAt: occurrence, durationMinutes: 60 } });
    const comment = await api.createComment!({ tripId: domainId(trip), authenticatedUserId: domainId(admin), postId: created.post.id, text: "Comentario reservado" });
    if (!comment.ok) throw comment.error;
    const mine = await page();
    const others = await page("/notifications", author);
    expect(mine.notifications.map((n) => n.type).sort()).toEqual(["activity.created", "comment.created", "post.created"]);
    expect(others.notifications.map((n) => n.type)).toEqual(["comment.created"]);
    const byType = Object.fromEntries(mine.notifications.map((n) => [n.type, n]));
    expect(byType["post.created"]).toMatchObject({ tripId: trip.toHexString(), actorId: author.toHexString(),
      payload: { postId: created.post.id, actorId: author.toHexString(), activityId: created.activity!.id } });
    expect(byType["activity.created"]!.payload).toEqual({ activityId: created.activity!.id, actorId: author.toHexString(), scheduledAt: occurrence.toISOString(), durationMinutes: 60 });
    expect(byType["comment.created"]).toMatchObject({ actorId: admin.toHexString(), payload: { commentId: comment.value.id, postId: created.post.id, actorId: admin.toHexString() } });
    const body = JSON.stringify(mine);
    for (const secret of ["Secreto del viaje", "Cena privada", "Comentario reservado"]) expect(body).not.toContain(secret);
    expect(body).not.toMatch(/token|password|eventKey|status|availableAt/i);
    for (const notification of mine.notifications) expect(Object.keys(notification).sort()).toEqual(["actorId", "createdAt", "id", "payload", "tripId", "type"]);
  });

  it("pages newest first by an opaque cursor without gaps or duplicates", async () => {
    for (let index = 0; index < 5; index += 1) await post(author, { description: `Post ${index}` });
    const all = (await page("/notifications?limit=60")).notifications;
    expect(all).toHaveLength(5);
    expect(all.map((n) => n.createdAt)).toEqual([...all.map((n) => n.createdAt)].sort().reverse());
    const seen: string[] = [];
    let cursor: string | null = null, requests = 0;
    do {
      const next = await page(`/notifications?limit=2${cursor === null ? "" : `&cursor=${cursor}`}`);
      expect(next.notifications.length).toBeLessThanOrEqual(2);
      seen.push(...next.notifications.map((n) => n.id));
      cursor = next.nextCursor; requests += 1;
    } while (cursor !== null && requests < 10);
    expect(requests).toBe(3);
    expect(seen).toEqual(all.map((n) => n.id));
    expect(new Set(seen).size).toBe(5);
    // A notice created after the first page does not shift the following pages.
    const first = await page("/notifications?limit=2");
    await post(author, { description: "Nuevo" });
    const second = await page(`/notifications?limit=2&cursor=${first.nextCursor}`);
    expect(second.notifications.map((n) => n.id)).toEqual(all.slice(2, 4).map((n) => n.id));
  });

  it("pages with limit=1 over a createdAt tie of the same recipient without skipping or repeating, ordered by _id desc", async () => {
    // post.created and activity.created of a spontaneous activity share the same createdAt.
    await post(author, { description: "Con actividad", newActivity: { title: "Cena", scheduledAt: occurrence, durationMinutes: 60 } });
    const tie = new Date("2026-09-25T12:30:00.000Z");
    await db.collection("outboxEvents").updateMany({ userId: reader }, { $set: { createdAt: tie } });
    const stored = await db.collection("outboxEvents").find({ userId: reader }).sort({ _id: -1 }).toArray();
    expect(stored.map((event) => event.type).sort()).toEqual(["activity.created", "post.created"]);
    expect(new Set(stored.map((event) => event.createdAt.getTime())).size).toBe(1);
    const seen: string[] = [];
    let cursor: string | null = null, requests = 0;
    do {
      const next = await page(`/notifications?limit=1${cursor === null ? "" : `&cursor=${cursor}`}`);
      expect(next.notifications).toHaveLength(1);
      seen.push(next.notifications[0]!.id);
      cursor = next.nextCursor; requests += 1;
    } while (cursor !== null && requests < 5);
    expect(seen).toEqual(stored.map((event) => event._id.toHexString()));
    expect(new Set(seen).size).toBe(2);
  });

  it.each([["limit=0"], ["limit=61"], ["limit=abc"], ["limit=1.5"], ["cursor=basura"], ["limit=2&limit=3"], ["since=1"]])("answers 422 with the invalid field for %s", async (query) => {
    const response = await get(`/notifications?${query}`);
    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.body)).toMatchObject({ error: { code: "ValidationError", fields: [{ field: expect.stringMatching(/limit|cursor|query/) }] } });
  });

  it("a member who was expelled loses the notices of that Trip but keeps the one of their expulsion", async () => {
    await post(author); await post(admin);
    expect((await page()).notifications).toHaveLength(2);
    const expelled = await api.expelMember!({ tripId: domainId(trip), actorUserId: domainId(admin), targetUserId: domainId(reader) });
    expect(expelled.ok).toBe(true);
    const after = await page();
    expect(after.notifications.map((n) => n.type)).toEqual(["member.expelled"]);
    expect(after.notifications[0]).toMatchObject({ tripId: trip.toHexString(), actorId: null, payload: { tripId: trip.toHexString() } });
    // The rest of the members never learn who was expelled.
    expect((await page("/notifications", author)).notifications.some((n) => n.type === "member.expelled")).toBe(false);
    expect(JSON.stringify(after)).not.toContain(admin.toHexString());
  });

  it("a user who left the Trip stops seeing its notices", async () => {
    await post(author);
    await db.collection("tripMembers").deleteOne({ tripId: trip, userId: reader });
    expect((await page()).notifications).toEqual([]);
  });

  it("reading changes nothing: not the participations, the markers, the events nor their delivery state", async () => {
    const owner = new ObjectId();
    await db.collection("tripMembers").insertOne({ tripId: trip, userId: owner, role: "participant", joinedAt: new Date() });
    const own = await api.createActivity!({ tripId: domainId(trip), authenticatedUserId: domainId(owner), dayId: domainId(day), title: "A", scheduledAt: occurrence, durationMinutes: 60 });
    if (!own.ok || own.value.outcome !== "created") throw new Error("Activity not created.");
    await db.collection("activityParticipations").insertOne({ tripId: trip, activityId: new ObjectId(own.value.activity.id), userId: reader, status: "pending", updatedAt: new Date(),
      decisionRequired: { reason: "schedule_conflict", changedFields: ["scheduledAt"], changedAt: new Date("2026-11-01T00:00:00Z") } });
    const before = [await db.collection("activityParticipations").find().sort({ _id: 1 }).toArray(), await outboxState()];
    expect((await page()).notifications.length).toBeGreaterThan(0);
    await page("/notifications?limit=1");
    expect([await db.collection("activityParticipations").find().sort({ _id: 1 }).toArray(), await outboxState()]).toEqual(before);
  });

  it("likes, post and comment edits and the retired votes create no notice", async () => {
    const created = await post(author);
    const comment = await api.createComment!({ tripId: domainId(trip), authenticatedUserId: domainId(author), postId: created.post.id, text: "Hola" });
    if (!comment.ok) throw comment.error;
    const before = await outboxState();
    const like = (method: string, url: string) => handleApiRequest({ method, url, authenticatedUserId: domainId(reader) }, { trips: api });
    expect((await like("PUT", `/trips/${trip}/posts/${created.post.id}/like`)).statusCode).toBe(200);
    expect((await like("PUT", `/trips/${trip}/posts/${created.post.id}/comments/${comment.value.id}/like`)).statusCode).toBe(200);
    expect((await like("DELETE", `/trips/${trip}/posts/${created.post.id}/like`)).statusCode).toBe(200);
    expect((await api.updatePost!({ tripId: domainId(trip), authenticatedUserId: domainId(reader), postId: created.post.id, description: "Editado" })).ok).toBe(true);
    expect((await api.updateComment!({ tripId: domainId(trip), authenticatedUserId: domainId(reader), postId: created.post.id, commentId: comment.value.id, text: "Editado" })).ok).toBe(true);
    const vote = await like("PUT", `/trips/${trip}/activities/${new ObjectId()}/vote`);
    expect(vote.statusCode).toBe(404);
    expect(await outboxState()).toEqual(before);
  });
});
