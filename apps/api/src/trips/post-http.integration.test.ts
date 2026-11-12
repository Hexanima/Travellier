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
  const input = () => ({ description: "Recuerdo" });
  const create = async (fields = {}) => {
    const response = await f.request("POST", f.path(), { ...input(), ...fields });
    expect(response.statusCode, response.body).toBe(201);
    return JSON.parse(response.body).post;
  };
  const links = async () => {
    const parent = await create();
    const activity = await f.api.createActivity!({ ...f.context(), dayId: domainId(f.day), title: "Cena", scheduledAt: f.occurrence });
    if (!activity.ok) throw activity.error;
    if (activity.value.outcome !== "created") throw new Error("Activity not created.");
    const transport = new ObjectId();
    await f.db.collection("transports").insertOne({ _id: transport, tripId: f.trip });
    return { activityId: activity.value.activity.id, parentPostId: parent.id, transportId: transport.toHexString() };
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
    expect(JSON.parse((await f.request("GET", `${f.path()}/${post.id}`)).body))
      .toEqual({ post: edited, parent: null, children: [], rootActivityId: null });
    expect(JSON.parse((await f.request("GET")).body)).toEqual({ posts: [edited] });
  });

  describe("expense in the post detail (T84)", () => {
    it("omits the expense key without an expense and answers the saved payments and shares after a PATCH", async () => {
      const post = await create(), url = `${f.path()}/${post.id}`;
      const ana = new ObjectId();
      await f.db.collection("tripMembers").insertOne({ tripId: f.trip, userId: ana, role: "participant", joinedAt: new Date() });
      expect(Object.keys(JSON.parse((await f.request("GET", url)).body)).sort()).toEqual(["children", "parent", "post", "rootActivityId"]);
      const payments = [{ userId: ana.toHexString(), unit: "amount", value: 400 }];
      const shares = [{ userId: ana.toHexString(), unit: "percent", value: 50 }];
      const saved = await f.request("PATCH", url, { expense: { totalAmount: 1000, currency: "ARS", payments, shares } });
      expect(saved.statusCode, saved.body).toBe(200);
      const detail = JSON.parse((await f.request("GET", url)).body);
      expect(detail.expense).toMatchObject({ totalAmount: 1000, currency: "ARS", payments, shares, formerMemberIds: [],
        completeness: { status: "incomplete" } });
    });

    it("reads a legacy paidBy as a payment of 100 percent and lists the unknown payer as a former member", async () => {
      const post = await create(), paidBy = new ObjectId();
      await f.db.collection("postExpenses").insertOne({ tripId: f.trip, postId: new ObjectId(post.id), totalAmount: 100, paidBy, createdAt: new Date() });
      const detail = JSON.parse((await f.request("GET", `${f.path()}/${post.id}`)).body);
      expect(detail.expense).toMatchObject({ currency: null, payments: [{ userId: paidBy.toHexString(), unit: "percent", value: 100 }],
        shares: [], formerMemberIds: [paidBy.toHexString()] });
      expect(detail.expense).not.toHaveProperty("paidBy");
    });
  });

  it.each(Array.from({ length: 8 }, (_, i) => i).filter((mask) => !(mask & 2) || !(mask & 5)))("creates combination %i and later links and unlinks independently", async (mask) => {
    const all = await links();
    const selected = { activityId: mask & 1 ? all.activityId : null, parentPostId: mask & 2 ? all.parentPostId : null, transportId: mask & 4 ? all.transportId : null };
    let post = await create(selected);
    expect(post).toMatchObject(selected);
    // A parent excludes direct activity/transport: start every field cycle from an independent post.
    const cleared = await f.request("PATCH", `${f.path()}/${post.id}`, { activityId: null, parentPostId: null, transportId: null });
    expect(cleared.statusCode).toBe(200); post = { ...post, activityId: null, parentPostId: null, transportId: null };
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
    const all = await links(), post = await create({ activityId: all.activityId, transportId: all.transportId }), before = await f.snapshot();
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

  it("rejects a parent together with activity or transport on POST and PATCH without writes", async () => {
    const all = await links(), plain = await create({ activityId: all.activityId });
    const transported = await create({ transportId: all.transportId }), before = await f.snapshot();
    for (const fields of [{ parentPostId: all.parentPostId, activityId: all.activityId },
      { parentPostId: all.parentPostId, transportId: all.transportId }, all]) {
      const response = await f.request("POST", f.path(), { ...input(), ...fields });
      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.body)).toMatchObject({ error: { fields: [{ field: "parentPostId", code: "conflict" }] } });
      expect(await f.snapshot()).toEqual(before);
    }
    for (const target of [plain, transported]) {
      const response = await f.request("PATCH", `${f.path()}/${target.id}`, { parentPostId: all.parentPostId });
      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.body)).toMatchObject({ error: { fields: [{ field: "parentPostId", code: "conflict" }] } });
      expect(await f.snapshot()).toEqual(before);
    }
    const moved = await f.request("PATCH", `${f.path()}/${plain.id}`, { parentPostId: all.parentPostId, activityId: null });
    expect(moved.statusCode).toBe(200);
    expect(JSON.parse(moved.body).post).toMatchObject({ parentPostId: all.parentPostId, activityId: null });
  });

  it("rejects indirect cycles and self-reference leaving Mongo untouched", async () => {
    const a = await create(), b = await create({ parentPostId: a.id }), c = await create({ parentPostId: b.id });
    const before = await f.snapshot();
    for (const [target, parent, code] of [[a.id, c.id, "cycle"], [a.id, b.id, "cycle"], [b.id, c.id, "cycle"], [c.id, c.id, "self_reference"]]) {
      const response = await f.request("PATCH", `${f.path()}/${target}`, { parentPostId: parent });
      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.body)).toMatchObject({ error: { fields: [{ field: "parentPostId", code }] } });
      expect(await f.snapshot()).toEqual(before);
    }
  });

  it("returns parent, direct children and root activity in the post detail", async () => {
    const all = await links(), root = await create({ activityId: all.activityId });
    const a = await create({ parentPostId: root.id }), b = await create({ parentPostId: a.id }), d = await create({ parentPostId: a.id });
    const detail = JSON.parse((await f.request("GET", `${f.path()}/${a.id}`)).body);
    expect(detail.post).toEqual(a);
    expect(detail.parent).toEqual({ id: root.id, authorId: root.authorId, createdAt: root.createdAt, description: root.description });
    expect(detail.children.map((c: { id: string }) => c.id)).toEqual([d.id, b.id]);
    expect(Object.keys(detail.children[0]).sort()).toEqual(["authorId", "createdAt", "description", "id"]);
    expect(detail.rootActivityId).toBe(all.activityId);
    expect(JSON.parse((await f.request("GET", `${f.path()}/${b.id}`)).body)).toMatchObject({ rootActivityId: all.activityId, children: [] });
    expect(JSON.parse((await f.request("GET", `${f.path()}/${root.id}`)).body)).toMatchObject({ parent: null });
    expect(JSON.parse((await f.request("GET", `${f.path()}/${all.parentPostId}`)).body))
      .toMatchObject({ parent: null, children: [], rootActivityId: null });
  });

  it("hides the chain of a post from another Trip", async () => {
    const root = await create(), foreign = new ObjectId();
    await f.db.collection("posts").insertOne({ _id: foreign, tripId: new ObjectId(), authorId: f.actor, createdAt: new Date(),
      description: null, mapsUrl: null, activityId: null, parentPostId: new ObjectId(root.id), transportId: null });
    expect((await f.request("GET", `${f.path()}/${foreign}`)).statusCode).toBe(404);
    expect(JSON.parse((await f.request("GET", `${f.path()}/${root.id}`)).body).children).toEqual([]);
  });

  it("rejects self-reference and malformed text without modifying the post", async () => {
    const post = await create(), before = await f.snapshot();
    for (const patch of [{ parentPostId: post.id }, { description: 42 }, { mapsUrl: [] }]) {
      expect((await f.request("PATCH", `${f.path()}/${post.id}`, patch)).statusCode).toBe(422);
      expect(await f.snapshot()).toEqual(before);
    }
  });

  it("creates posts without dayId before, after or without a Trip itinerary and ignores client dayId and createdAt", async () => {
    const foreign = new ObjectId();
    await f.db.collection("itineraryDays").insertOne({ _id: foreign, tripId: new ObjectId() });
    for (const fields of [{}, { dayId: foreign.toHexString() }, { dayId: "invalid" }, { dayId: null }, { dayId: 42 },
      { createdAt: "2020-01-01T00:00:00.000Z" }, { createdAt: "2040-01-01T00:00:00.000Z", dayId: f.day.toHexString() }]) {
      const post = await create(fields);
      expect(post).not.toHaveProperty("dayId");
      expect(Math.abs(Date.now() - Date.parse(post.createdAt))).toBeLessThan(60_000);
      expect(await f.db.collection("posts").findOne({ _id: new ObjectId(post.id) })).not.toHaveProperty("dayId");
    }
    await f.db.collection("itineraryDays").deleteMany({ tripId: f.trip });
    await create();
  });

  it("does not make dayId editable: a dayId-only PATCH is 400 and other fields are edited ignoring it", async () => {
    const post = await create(), before = await f.snapshot();
    for (const dayId of [f.day.toHexString(), null, "invalid", new ObjectId().toHexString()]) {
      expect((await f.request("PATCH", `${f.path()}/${post.id}`, { dayId })).statusCode).toBe(400);
      expect(await f.snapshot()).toEqual(before);
    }
    const response = await f.request("PATCH", `${f.path()}/${post.id}`, { dayId: new ObjectId().toHexString(), description: "Nuevo" });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).post).toEqual({ ...post, description: "Nuevo" });
  });

  it("lists by publication descending, breaking ties by id descending", async () => {
    const newer = new Date("2026-10-05T00:00:00.002Z"), tied = new Date("2026-10-04T00:00:00.001Z");
    const ids = [new ObjectId(), new ObjectId(), new ObjectId(), new ObjectId()].sort((a, b) => a.toHexString().localeCompare(b.toHexString()));
    await f.db.collection("posts").insertMany([
      { _id: ids[0]!, tripId: f.trip, authorId: f.actor, createdAt: tied }, { _id: ids[2]!, tripId: f.trip, authorId: f.actor, createdAt: tied },
      { _id: ids[1]!, tripId: f.trip, authorId: f.actor, createdAt: newer }, { _id: ids[3]!, tripId: f.trip, authorId: f.actor, createdAt: new Date(0) },
    ].map((doc) => ({ ...doc, description: null, mapsUrl: null, activityId: null, parentPostId: null, transportId: null })));
    const response = await f.request("GET");
    expect(JSON.parse(response.body).posts.map((p: { id: string }) => p.id))
      .toEqual([ids[1], ids[2], ids[0], ids[3]].map((id) => id!.toHexString()));
  });

  it("reads legacy posts with and without dayId, without exposing it", async () => {
    const legacy = new ObjectId();
    await f.db.collection("posts").insertOne({ _id: legacy, tripId: f.trip, dayId: new ObjectId(), authorId: f.actor, description: "Viejo",
      mapsUrl: null, activityId: null, parentPostId: null, transportId: null, createdAt: new Date("2026-01-01T00:00:00.123Z") });
    const response = await f.request("GET", `${f.path()}/${legacy}`);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).post).toEqual({ id: legacy.toHexString(), tripId: f.trip.toHexString(), authorId: f.actor.toHexString(),
      description: "Viejo", mapsUrl: null, activityId: null, parentPostId: null, transportId: null, createdAt: "2026-01-01T00:00:00.123Z" });
  });

  it("returns 400 for malformed route IDs, JSON and empty or protected-only PATCH", async () => {
    const post = await create();
    for (const payload of [{}, { authorId: f.actor.toHexString() }, [], "{", null])
      expect((await f.request("PATCH", `${f.path()}/${post.id}`, payload)).statusCode).toBe(400);
    expect((await f.request("GET", "/trips/invalid/posts")).statusCode).toBe(400);
    expect((await f.request("GET", `${f.path()}/invalid`)).statusCode).toBe(400);
    expect((await f.request("POST", f.path(), "{")).statusCode).toBe(400);
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

  it("creates a joint activity saving the author's going and exposing it with the post", async () => {
    const response = await f.request("POST", f.path(), { ...input(), dayId: f.day.toHexString(), newActivity: { title: "Cena", scheduledAt: f.occurrence.toISOString() } });
    expect(response.statusCode, response.body).toBe(201);
    const body = JSON.parse(response.body);
    expect(Object.keys(body).sort()).toEqual(["activity", "participation", "post"]);
    expect(body.participation).toMatchObject({ activityId: body.activity.id, userId: f.actor.toHexString(), status: "going" });
    expect(await f.db.collection("activityParticipations").find().toArray()).toMatchObject([
      { tripId: f.trip, activityId: new ObjectId(body.activity.id), userId: f.actor, status: "going" }]);
  });

  it("keeps the 201 shape of posts without a new activity", async () => {
    const response = await f.request("POST", f.path(), input());
    expect(Object.keys(JSON.parse(response.body))).toEqual(["post"]);
    expect(await f.db.collection("activityParticipations").countDocuments()).toBe(0);
  });

  it("derives the slice without dayId and publishes now even when the activity records a past moment", async () => {
    const response = await f.request("POST", f.path(), { ...input(), newActivity: { title: "Cena", scheduledAt: f.occurrence.toISOString(), durationMinutes: 60 } });
    expect(response.statusCode, response.body).toBe(201);
    const { post, activity } = JSON.parse(response.body);
    expect(activity.dayId).toBe(f.day.toHexString()); expect(activity.scheduledAt).toBe(f.occurrence.toISOString());
    expect(Date.parse(post.createdAt)).toBeGreaterThan(Date.parse(activity.scheduledAt));
    const outside = await f.request("POST", f.path(), { ...input(), newActivity: { title: "Cena", scheduledAt: "2026-09-30T12:00:00Z" } });
    expect(outside.statusCode).toBe(422);
    expect(JSON.parse(outside.body)).toMatchObject({ error: { fields: [{ field: "scheduledAt", code: "outside_window" }] } });
    const invalid = await f.request("POST", f.path(), { ...input(), dayId: "nope", newActivity: { title: "Cena", scheduledAt: f.occurrence.toISOString() } });
    expect(invalid.statusCode).toBe(422);
  });

  describe("author's agenda conflicts", () => {
    const withDuration = { title: "Cena", scheduledAt: f.occurrence.toISOString(), durationMinutes: 60 };
    const seedConflicts = async () => {
      const ids: string[] = [];
      for (const [title, scheduledAt] of [["Plan A", "2026-09-25T12:30:00Z"], ["Plan B", "2026-09-25T11:30:00Z"]] as const) {
        const created = await f.api.createActivity!({ ...f.context(), dayId: domainId(f.day), title, scheduledAt: new Date(scheduledAt), durationMinutes: 60 });
        if (!created.ok || created.value.outcome !== "created") throw new Error("seed failed");
        ids.push(created.value.activity.id);
      }
      return ids;
    };
    const confirmation = (body: { conflicts: unknown; activity: unknown }) => ({ confirmedConflicts: body.conflicts, confirmedActivity: body.activity });
    // The Trip lock bumps destinationOrderRevision even when nothing is written; compare the data collections only.
    const data = async () => (await f.snapshot()).slice(1);

    it("answers 409 without writing and then publishes everything with the confirmation", async () => {
      const [a, b] = await seedConflicts(); const before = await data();
      const response = await f.request("POST", f.path(), { ...input(), newActivity: withDuration });
      expect(response.statusCode, response.body).toBe(409);
      const body = JSON.parse(response.body).error;
      expect(body).toMatchObject({ code: "ParticipationConflictError",
        conflicts: [{ activityId: b, durationMinutes: 60 }, { activityId: a, durationMinutes: 60 }],
        activity: { scheduledAt: f.occurrence.toISOString(), durationMinutes: 60 } });
      expect(await data()).toEqual(before);
      const confirmed = await f.request("POST", f.path(), { ...input(), newActivity: withDuration, ...confirmation(body) });
      expect(confirmed.statusCode, confirmed.body).toBe(201);
      const created = JSON.parse(confirmed.body);
      const statuses = Object.fromEntries((await f.db.collection("activityParticipations").find().toArray()).map((p) => [p.activityId.toHexString(), p.status]));
      expect(statuses).toEqual({ [a!]: "not_going", [b!]: "not_going", [created.activity.id]: "going" });
    });

    it("rejects malformed confirmations with 422 and no writes", async () => {
      await seedConflicts(); const before = await data();
      for (const fields of [{ confirmedConflicts: "x" }, { confirmedConflicts: [{ activityId: "no" }] }, { confirmedActivity: "x" }]) {
        expect((await f.request("POST", f.path(), { ...input(), newActivity: withDuration, ...fields })).statusCode).toBe(422);
      }
      expect(await data()).toEqual(before);
    });

    it("answers 422 (not 409) when the duration exceeds the window even with conflicts", async () => {
      await seedConflicts(); const before = await data();
      const response = await f.request("POST", f.path(), { ...input(), newActivity: { ...withDuration, durationMinutes: 600 } });
      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.body)).toMatchObject({ error: { fields: [{ field: "durationMinutes", code: "outside_window" }] } });
      expect(await data()).toEqual(before);
    });

    describe("PATCH relink to a new activity", () => {
      const patch = (postId: string, fields: object, user = f.actor) => f.request("PATCH", `${f.path()}/${postId}`, fields, user);

      it("creates the activity for an existing post keeping its createdAt and the author's going", async () => {
        const post = await create(); const before = await f.db.collection("posts").findOne({ _id: new ObjectId(post.id) });
        const response = await patch(post.id, { newActivity: withDuration });
        expect(response.statusCode, response.body).toBe(200);
        const body = JSON.parse(response.body);
        expect(Object.keys(body).sort()).toEqual(["activity", "participation", "post"]);
        expect(body.post).toEqual({ ...post, activityId: body.activity.id });
        expect(body.post.createdAt).toBe(post.createdAt);
        expect(body.participation).toMatchObject({ activityId: body.activity.id, userId: f.actor.toHexString(), status: "going" });
        expect(await f.db.collection("posts").findOne({ _id: new ObjectId(post.id) })).toEqual({ ...before, activityId: new ObjectId(body.activity.id) });
      });

      it("answers 409 without writing and links with the confirmation", async () => {
        await seedConflicts(); const post = await create(); const before = await data();
        const response = await patch(post.id, { newActivity: withDuration });
        expect(response.statusCode).toBe(409);
        expect(await data()).toEqual(before);
        const confirmed = await patch(post.id, { newActivity: withDuration, ...confirmation(JSON.parse(response.body).error) });
        expect(confirmed.statusCode, confirmed.body).toBe(200);
        expect(JSON.parse(confirmed.body).post.createdAt).toBe(post.createdAt);
        expect(await f.db.collection("activityParticipations").countDocuments({ status: "not_going" })).toBe(2);
      });

      it("rejects a post with a parent, activityId with newActivity and keeps a dayId-only edit as 400", async () => {
        const parent = await create(), child = await create({ parentPostId: parent.id }), independent = await create(); const before = await data();
        expect((await patch(child.id, { newActivity: withDuration })).statusCode).toBe(422);
        expect((await patch(independent.id, { newActivity: withDuration, activityId: new ObjectId().toHexString() })).statusCode).toBe(422);
        expect((await patch(independent.id, { dayId: f.day.toHexString() })).statusCode).toBe(400);
        expect(await data()).toEqual(before);
        expect((await patch(child.id, { newActivity: withDuration, parentPostId: null })).statusCode).toBe(200);
      });

      it("leaves a third member without response and hides it from non-members", async () => {
        const third = new ObjectId();
        await f.db.collection("tripMembers").insertOne({ tripId: f.trip, userId: third, role: "participant", joinedAt: new Date() });
        const post = await create(), outsider = new ObjectId(), before = await data();
        expect((await patch(post.id, { newActivity: withDuration }, outsider)).statusCode).toBe(404);
        expect(await data()).toEqual(before);
        const body = JSON.parse((await patch(post.id, { newActivity: withDuration })).body);
        const seen = await f.request("GET", `/trips/${f.trip}/activities/${body.activity.id}/participation`, undefined, third);
        expect(JSON.parse(seen.body)).toEqual({ participation: null });
      });
    });
  });

  it.each(["2026-09-25T09:00:00.456-03:00", "2026-09-25T12:00:00.456Z"])("creates joint activity at %s and exposes both in itinerary", async (scheduledAt) => {
    const response = await f.request("POST", f.path(), { ...input(), dayId: f.day.toHexString(), newActivity: { title: "Cena", scheduledAt } });
    expect(response.statusCode, response.body).toBe(201);
    const { post, activity } = JSON.parse(response.body);
    expect(post.activityId).toBe(activity.id); expect(activity.scheduledAt).toBe(f.occurrence.toISOString());
    const itinerary = JSON.parse((await f.request("GET", `/trips/${f.trip}/itinerary`)).body).itinerary;
    expect(itinerary.activities).toMatchObject([{ ...activity, postIds: [post.id] }]);
    expect(itinerary.posts).toMatchObject([{ id: post.id, dayId: activity.dayId, activityId: activity.id,
      context: { placement: "activity", rootActivityId: activity.id, rootPostId: post.id } }]);
    expect(itinerary.unplacedPosts).toEqual([]);
    expect(JSON.parse((await f.request("GET")).body).posts).toMatchObject([{ id: post.id, activityId: activity.id }]);
    expect((await f.request("PATCH", `${f.path()}/${post.id}`, { activityId: null })).statusCode).toBe(200);
  });

  it.each([undefined, null, "", "invalid", "2026-09-25", "2026-09-25T12:00:00", "2026-02-30T12:00:00Z", "2026-09-25T24:00:00Z", "2026-09-25T12:00:00.4567Z", "2026-09-25T09:00:00Z"])("rejects invalid joint activity time %s without creating anything", async (scheduledAt) => {
    const before = await f.snapshot();
    expect((await f.request("POST", f.path(), { ...input(), dayId: f.day.toHexString(), newActivity: { title: "Cena", scheduledAt } })).statusCode).toBe(422);
    expect(await f.snapshot()).toEqual(before);
  });

  it("rejects malformed or ambiguous newActivity payloads", async () => {
    const before = await f.snapshot();
    for (const newActivity of [null, [], "Cena", {}, { title: " " }, { title: "Cena", scheduledAt: f.occurrence.toISOString(), mapsUrl: 42 }])
      expect((await f.request("POST", f.path(), { ...input(), dayId: f.day.toHexString(), newActivity })).statusCode).toBe(422);
    expect((await f.request("POST", f.path(), { ...input(), dayId: f.day.toHexString(), activityId: new ObjectId().toHexString(), newActivity: { title: "Cena", scheduledAt: f.occurrence.toISOString() } })).statusCode).toBe(422);
    expect(await f.snapshot()).toEqual(before);
  });

  it("creates a spontaneous activity with duration preserving start, duration and milliseconds", async () => {
    const response = await f.request("POST", f.path(), { ...input(), dayId: f.day.toHexString(),
      newActivity: { title: "Cena", scheduledAt: "2026-09-25T09:00:00.456-03:00", durationMinutes: 90 } });
    expect(response.statusCode, response.body).toBe(201);
    const { post, activity } = JSON.parse(response.body);
    expect(activity).toMatchObject({ scheduledAt: "2026-09-25T12:00:00.456Z", durationMinutes: 90 });
    expect(post.activityId).toBe(activity.id);
    expect(await f.db.collection("activities").findOne({ _id: new ObjectId(activity.id) }))
      .toMatchObject({ scheduledAt: new Date("2026-09-25T12:00:00.456Z"), durationMinutes: 90 });
    // A later start: the author is already going to the 90-minute activity above, so the same start would now need a confirmation.
    const plain = await f.request("POST", f.path(), { ...input(), dayId: f.day.toHexString(), newActivity: { title: "Cena", scheduledAt: "2026-09-25T15:00:00.000Z" } });
    expect(JSON.parse(plain.body).activity).toMatchObject({ durationMinutes: null });
  });

  it.each(["90", true, {}, 0, -1, 2.5, 400])("rejects spontaneous duration %s without creating post or activity", async (durationMinutes) => {
    const before = await f.snapshot();
    const response = await f.request("POST", f.path(), { ...input(), dayId: f.day.toHexString(),
      newActivity: { title: "Cena", scheduledAt: f.occurrence.toISOString(), durationMinutes } });
    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.body)).toMatchObject({ error: { fields: [{ field: "durationMinutes" }] } });
    expect(await f.snapshot()).toEqual(before);
    expect(await f.db.collection("activities").countDocuments()).toBe(0);
  });

  it("reflects transport and parent links and preserves post content when its activity is deleted", async () => {
    const transport = await f.configureTransports(), parent = await create();
    const response = await f.request("POST", f.path(), { ...input(), dayId: f.day.toHexString(), transportId: transport.id,
      newActivity: { title: "Cena", scheduledAt: f.occurrence.toISOString() } });
    expect(response.statusCode).toBe(201); const { post, activity } = JSON.parse(response.body);
    const child = await create({ parentPostId: parent.id });
    const itinerary = JSON.parse((await f.request("GET", `/trips/${f.trip}/itinerary`)).body).itinerary;
    // parent and child were published now, outside the Trip dates: they are kept as unplaced posts, never lost.
    expect(itinerary.posts.map((p: { id: string }) => p.id)).toEqual([post.id]);
    expect(itinerary.unplacedPosts.map((p: { id: string }) => p.id).sort()).toEqual([parent.id, child.id].sort());
    expect(itinerary.posts.find((p: { id: string }) => p.id === post.id)).toMatchObject({ dayId: activity.dayId, context: { placement: "activity", rootActivityId: activity.id, rootTransportId: transport.id } });
    expect(itinerary.activities).toMatchObject([{ id: activity.id, postIds: [post.id] }]);
    expect(itinerary.transports.find((t: { id: string }) => t.id === transport.id).postIds).toEqual([post.id]);
    expect(itinerary.unplacedPosts.find((p: { id: string }) => p.id === child.id)).toMatchObject({ dayId: null, parentPostId: parent.id, context: { parentPostId: parent.id, rootPostId: parent.id } });
    expect(post).toMatchObject({ transportId: transport.id, parentPostId: null, activityId: activity.id });
    expect(child).toMatchObject({ parentPostId: parent.id, activityId: null, transportId: null });
    expect((await f.request("DELETE", `/trips/${f.trip}/activities/${activity.id}`)).statusCode).toBe(204);
    expect(JSON.parse((await f.request("GET", `${f.path()}/${post.id}`)).body)).toMatchObject({ post: { ...post, activityId: null }, rootActivityId: null });
  });

  it("returns 503 for unavailable dependencies and generic 500 for persistence errors", async () => {
    expect((await handleApiRequest({ method: "GET", url: f.path(), authenticatedUserId: domainId(f.actor) })).statusCode).toBe(503);
    expect(f.api.createPost).toBeTypeOf("function");
    f.api.createPost = async () => err(new UnknownError("secret detail"));
    const response = await f.request("POST", f.path(), input());
    expect(response.statusCode).toBe(500); expect(response.body).not.toContain("secret detail");
  });

  describe("DELETE /trips/:tripId/posts/:postId (T126)", () => {
    const url = (id: string, trip = f.trip.toHexString()) => `/trips/${trip}/posts/${id}`;
    const member = async (role: "admin" | "participant") => {
      const userId = new ObjectId();
      await f.db.collection("tripMembers").insertOne({ tripId: f.trip, userId, role, joinedAt: new Date() });
      return userId;
    };

    it("answers 204 without a body to the author and the post is gone", async () => {
      const post = await create();
      const response = await f.request("DELETE", url(post.id));
      expect([response.statusCode, response.body]).toEqual([204, ""]);
      expect((await f.request("GET", url(post.id))).statusCode).toBe(404);
      expect(await f.db.collection("posts").countDocuments({})).toBe(0);
    });

    it("answers 204 to an admin deleting another member's post", async () => {
      const post = await create(), admin = await member("admin");
      const response = await f.request("DELETE", url(post.id), undefined, admin);
      expect([response.statusCode, response.body]).toEqual([204, ""]);
      expect(await f.db.collection("posts").countDocuments({})).toBe(0);
    });

    it("answers 403 Forbidden to a participant who is not the author and keeps the post", async () => {
      const post = await create(), other = await member("participant");
      const response = await f.request("DELETE", url(post.id), undefined, other);
      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).error.code).toBe("Forbidden");
      expect(await f.db.collection("posts").countDocuments({})).toBe(1);
    });

    it("answers 404 to a non member, a Trip that is not theirs, an unknown post and a repeated delete", async () => {
      const post = await create(), stranger = new ObjectId();
      expect((await f.request("DELETE", url(post.id), undefined, stranger)).statusCode).toBe(404);
      expect((await f.request("DELETE", url(new ObjectId().toHexString()))).statusCode).toBe(404);
      expect((await f.request("DELETE", url(post.id, new ObjectId().toHexString()))).statusCode).toBe(404);
      expect((await f.request("DELETE", url(post.id))).statusCode).toBe(204);
      const repeated = await f.request("DELETE", url(post.id));
      expect([repeated.statusCode, JSON.parse(repeated.body).error.code]).toEqual([404, "PostNotFoundError"]);
    });

    it("answers 401 without a session and 400 for an invalid id, changing nothing", async () => {
      const post = await create();
      expect((await handleApiRequest({ method: "DELETE", url: url(post.id) }, { trips: f.api })).statusCode).toBe(401);
      expect((await f.request("DELETE", url("nope"))).statusCode).toBe(400);
      expect((await f.request("DELETE", url(post.id, "nope"))).statusCode).toBe(400);
      expect(await f.db.collection("posts").countDocuments({})).toBe(1);
    });

    it("answers 503 when the posts API is not configured and takes the identity only from the token", async () => {
      const post = await create();
      expect((await handleApiRequest({ method: "DELETE", url: url(post.id), authenticatedUserId: domainId(f.actor) })).statusCode).toBe(503);
      const forged = await handleApiRequest({ method: "DELETE", url: url(post.id), body: { authorId: f.actor.toHexString(), authenticatedUserId: f.actor.toHexString() },
        authenticatedUserId: domainId(await member("participant")) }, { trips: f.api });
      expect(forged.statusCode).toBe(403);
    });
  });
});
