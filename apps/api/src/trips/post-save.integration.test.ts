import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createPhotoUploadKey } from "app-domain";
import { PostFixture, domainId } from "../../test/post-fixture.js";
import { FakeObjectStorage } from "../../test/fake-object-storage.js";

/** T87: the joint save of a memory (activity, post, participation, plan change, photos and expense) end to end, and its safe retry. */
describe("joint post save and idempotent retry", () => {
  const f = new PostFixture();
  let fake: FakeObjectStorage;
  beforeAll(() => f.start("post_save"), 120_000);
  afterAll(() => f.stop());
  // Same discipline as the other concurrency suites: every pause is released and every launched operation awaited after each test.
  let pendingReleases: Array<() => void> = [];
  let launched: Array<Promise<unknown>> = [];
  afterEach(async () => {
    for (const release of pendingReleases) release();
    pendingReleases = [];
    await Promise.allSettled(launched);
    launched = [];
  });
  beforeEach(async () => { vi.restoreAllMocks(); fake = new FakeObjectStorage(); f.storage = fake; await f.reset(); });

  const hex = (value: ObjectId) => value.toHexString();
  const newId = () => new ObjectId().toHexString();
  const keyFor = (user: ObjectId = f.actor) => {
    const key = createPhotoUploadKey({ tripId: domainId(f.trip), userId: domainId(user), uploadId: randomUUID(), extension: "jpg" });
    fake.put(key, "image/jpeg");
    return key;
  };
  const photoRefs = (count: number, user?: ObjectId) => Array.from({ length: count }, () => ({ key: keyFor(user) }));
  const addMember = async (role: "admin" | "participant") => {
    const userId = new ObjectId();
    await f.db.collection("tripMembers").insertOne({ tripId: f.trip, userId, role, joinedAt: new Date() });
    return userId;
  };
  const withDuration = () => ({ title: "Cena", scheduledAt: f.occurrence.toISOString(), durationMinutes: 60 });
  const counts = async () => Object.fromEntries(await Promise.all(["posts", "activities", "activityParticipations", "postPhotos", "postExpenses"]
    .map(async (name) => [name, await f.db.collection(name).countDocuments({})])));
  // The Trip lock bumps destinationOrderRevision even when nothing is written; compare the data collections only.
  const data = async () => Promise.all(["posts", "activities", "activityParticipations", "postPhotos", "postExpenses"]
    .map((name) => f.db.collection(name).find().sort({ _id: 1 }).toArray()));
  const post = (body: unknown, user = f.actor) => f.request("POST", f.path(), body, user);
  const patch = (postId: string, body: unknown, user = f.actor) => f.request("PATCH", `${f.path()}/${postId}`, body, user);
  const seedActivity = async (title: string, scheduledAt: string) => {
    const created = await f.api.createActivity!({ ...f.context(), dayId: domainId(f.day), title, scheduledAt: new Date(scheduledAt), durationMinutes: 60 });
    if (!created.ok || created.value.outcome !== "created") throw new Error("seed failed");
    return created.value.activity.id;
  };
  const expenseOf = async (members: ObjectId[]) => ({ totalAmount: 1000, currency: "ARS",
    payments: [{ userId: hex(members[0]!), unit: "amount", value: 1000 }],
    shares: [{ userId: hex(members[0]!), unit: "percent", value: 50 }, { userId: hex(members[1]!), unit: "remainder", value: null }] });

  describe("assembly of the joint save (existing behavior fixed by tests)", () => {
    it("one POST with new activity, photos and an expense with payments and shares: 409 on conflict writes nothing, then the confirmation saves everything once", async () => {
      const [ana, beto] = [await addMember("participant"), await addMember("participant")];
      const a = await seedActivity("Plan A", "2026-09-25T12:30:00Z"), b = await seedActivity("Plan B", "2026-09-25T11:30:00Z");
      const body = { id: newId(), description: "Cena", newActivity: withDuration(), photos: photoRefs(2), expense: await expenseOf([ana, beto]) };
      const before = await data();
      const refused = await post(body);
      expect(refused.statusCode, refused.body).toBe(409);
      const conflict = JSON.parse(refused.body).error;
      expect(conflict.code).toBe("ParticipationConflictError");
      expect(await data()).toEqual(before);
      const confirmed = await post({ ...body, confirmedConflicts: conflict.conflicts, confirmedActivity: conflict.activity });
      expect(confirmed.statusCode, confirmed.body).toBe(201);
      const saved = JSON.parse(confirmed.body);
      expect(saved).toMatchObject({ post: { id: body.id, authorId: hex(f.actor) }, activity: { createdBy: hex(f.actor) },
        participation: { status: "going" }, photos: [{ order: 1 }, { order: 2 }], expense: { totalAmount: 1000, currency: "ARS", completeness: { status: "complete" } } });
      expect(await counts()).toEqual({ posts: 1, activities: 3, activityParticipations: 3, postPhotos: 2, postExpenses: 1 });
      const statuses = Object.fromEntries((await f.db.collection("activityParticipations").find().toArray()).map((p) => [hex(p.activityId), p.status]));
      expect(statuses).toEqual({ [a]: "not_going", [b]: "not_going", [saved.activity.id]: "going" });
      expect(await f.db.collection("postPhotos").countDocuments({ postId: new ObjectId(body.id), tripId: f.trip })).toBe(2);
      expect(await f.db.collection("postExpenses").findOne({ postId: new ObjectId(body.id) })).toMatchObject({ payments: expect.any(Array), shares: expect.any(Array) });
    });

    it("independent post, chain child, transport link and relink of an existing activity each save with photos and expense in one POST", async () => {
      const [ana, beto] = [await addMember("participant"), await addMember("participant")];
      const expense = await expenseOf([ana, beto]);
      const independent = JSON.parse((await post({ description: "Solo", photos: photoRefs(1), expense })).body);
      expect(independent).toMatchObject({ post: { activityId: null, parentPostId: null, transportId: null }, photos: [{ order: 1 }], expense: { totalAmount: 1000 } });
      const child = JSON.parse((await post({ description: "Hijo", parentPostId: independent.post.id, photos: photoRefs(1), expense })).body);
      expect(child.post.parentPostId).toBe(independent.post.id);
      const transport = new ObjectId(); await f.db.collection("transports").insertOne({ _id: transport, tripId: f.trip });
      const onTransport = JSON.parse((await post({ description: "Viaje", transportId: hex(transport), expense })).body);
      expect(onTransport.post.transportId).toBe(hex(transport));
      const existing = await seedActivity("Existente", "2026-09-25T15:00:00Z");
      const onActivity = JSON.parse((await post({ description: "En actividad", activityId: existing, photos: photoRefs(1), expense })).body);
      expect(onActivity).toMatchObject({ post: { activityId: existing } });
      expect(onActivity.activity).toBeUndefined();
      expect(await counts()).toMatchObject({ posts: 4, activities: 1, postPhotos: 3, postExpenses: 4 });
    });

    it("a combined PATCH by another member keeps authorId and createdAt, the earlier photos and the payments and shares it omits", async () => {
      const [ana, beto] = [await addMember("participant"), await addMember("participant")];
      const editor = await addMember("admin");
      const first = JSON.parse((await post({ description: "Original", photos: photoRefs(1), expense: await expenseOf([ana, beto]) })).body);
      const response = await patch(first.post.id, { description: "Editado", newActivity: withDuration(), photos: photoRefs(1, editor), expense: { breakdown: "agua" } }, editor);
      expect(response.statusCode, response.body).toBe(200);
      const saved = JSON.parse(response.body);
      expect(saved.post).toMatchObject({ id: first.post.id, authorId: first.post.authorId, createdAt: first.post.createdAt, description: "Editado",
        activityId: saved.activity.id });
      expect(saved.activity.createdBy).toBe(hex(editor));
      expect(saved.participation).toMatchObject({ userId: hex(editor), status: "going" });
      expect(saved.photos).toHaveLength(2);
      expect(saved.expense).toMatchObject({ breakdown: "agua", payments: first.expense.payments, shares: first.expense.shares });
      const stored = await f.db.collection("posts").findOne({ _id: new ObjectId(first.post.id) });
      expect(stored).toMatchObject({ authorId: f.actor, createdAt: new Date(first.post.createdAt) });
      expect(await counts()).toEqual({ posts: 1, activities: 1, activityParticipations: 1, postPhotos: 2, postExpenses: 1 });
    });

    it("rolls back the whole save, photos and expense included, when the activity insertion fails", async () => {
      const [ana, beto] = [await addMember("participant"), await addMember("participant")];
      const before = await data();
      const collection = f.db.collection("activities"), original = f.db.collection.bind(f.db);
      vi.spyOn(collection, "insertOne").mockRejectedValueOnce(new Error("forced failure"));
      vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === "activities" ? collection : original(key, options));
      const response = await post({ id: newId(), newActivity: withDuration(), photos: photoRefs(1), expense: await expenseOf([ana, beto]) });
      expect(response.statusCode).toBe(500);
      expect(await data()).toEqual(before);
    });
  });

  describe("idempotent retry by client post id (T87)", () => {
    it("without id the server generates one and a retry creates another post (as before)", async () => {
      const first = JSON.parse((await post({ description: "Hola" })).body), second = JSON.parse((await post({ description: "Hola" })).body);
      expect(first.post.id).not.toBe(second.post.id);
      expect(await counts()).toMatchObject({ posts: 2 });
    });

    it("uses the id as the post _id and a retry with the same body answers the same 201 without writing anything", async () => {
      const [ana, beto] = [await addMember("participant"), await addMember("participant")];
      const body = { id: newId(), description: "Cena", newActivity: withDuration(), photos: photoRefs(2), expense: await expenseOf([ana, beto]) };
      const first = await post(body);
      expect(first.statusCode, first.body).toBe(201);
      expect(JSON.parse(first.body).post.id).toBe(body.id);
      expect(await f.db.collection("posts").countDocuments({ _id: new ObjectId(body.id) })).toBe(1);
      const before = await data();
      const retry = await post(body);
      expect(retry.statusCode, retry.body).toBe(201);
      expect(JSON.parse(retry.body)).toEqual(JSON.parse(first.body));
      expect(await data()).toEqual(before);
      expect(await counts()).toEqual({ posts: 1, activities: 1, activityParticipations: 1, postPhotos: 2, postExpenses: 1 });
    });

    it("the client aborting after the commit loses nothing: the retry returns what was saved", async () => {
      const body = { id: newId(), description: "Cena", newActivity: withDuration(), photos: photoRefs(1) };
      const aborted = await f.api.createPost!({ ...f.context(), postId: domainId(new ObjectId(body.id)), description: "Cena",
        newActivity: { title: "Cena", scheduledAt: f.occurrence, durationMinutes: 60 }, photos: body.photos });
      expect(aborted.ok).toBe(true); // committed; the response never reached the client
      const retry = await post(body);
      expect(retry.statusCode, retry.body).toBe(201);
      expect(JSON.parse(retry.body)).toMatchObject({ post: { id: body.id }, photos: [{ order: 1 }], participation: { status: "going" } });
      expect(await counts()).toMatchObject({ posts: 1, activities: 1, activityParticipations: 1, postPhotos: 1 });
    });

    it("a retry with another body is 409 PostRequestConflictError without writes", async () => {
      const body = { id: newId(), description: "Cena", photos: photoRefs(1) };
      expect((await post(body)).statusCode).toBe(201);
      const before = await data();
      for (const other of [{ ...body, description: "Otra" }, { ...body, photos: photoRefs(1) }, { ...body, photos: undefined }, { ...body, newActivity: withDuration() }]) {
        const response = await post(other);
        expect(response.statusCode, response.body).toBe(409);
        expect(JSON.parse(response.body).error).toMatchObject({ code: "PostRequestConflictError", reason: "already_saved", postId: body.id });
      }
      expect(await data()).toEqual(before);
    });

    it("a retry after another member edited the saved post is 409 already_saved with the post id (own post, own Trip), without writes", async () => {
      const editor = await addMember("admin");
      const body = { id: newId(), description: "Cena", photos: photoRefs(1) };
      expect((await post(body)).statusCode).toBe(201);
      expect((await patch(body.id, { description: "Editado por otro" }, editor)).statusCode).toBe(200);
      const before = await data();
      const retry = await post(body);
      expect(retry.statusCode, retry.body).toBe(409);
      expect(JSON.parse(retry.body).error).toMatchObject({ code: "PostRequestConflictError", reason: "already_saved", postId: body.id });
      expect(await data()).toEqual(before);
    });

    it("a PATCH retry after another member edited the post is 409 already_saved with the post id, without writes", async () => {
      const editor = await addMember("admin");
      const created = JSON.parse((await post({ description: "Original" })).body).post;
      const body = { description: "Editado", newActivity: { ...withDuration(), id: newId() } };
      expect((await patch(created.id, body)).statusCode).toBe(200);
      expect((await patch(created.id, { description: "Cambiado por otro" }, editor)).statusCode).toBe(200);
      const before = await data();
      const retry = await patch(created.id, body);
      expect(retry.statusCode, retry.body).toBe(409);
      expect(JSON.parse(retry.body).error).toMatchObject({ code: "PostRequestConflictError", reason: "already_saved", postId: created.id });
      expect(await data()).toEqual(before);
    });

    it("another author or another Trip reusing the id gets the same generic 409, and nothing is written or leaked", async () => {
      const body = { id: newId(), description: "Mio" };
      expect((await post(body)).statusCode).toBe(201);
      const other = await addMember("participant");
      const byOther = await post(body, other);
      const otherTrip = new ObjectId(), outsider = new ObjectId();
      await f.db.collection("trips").insertOne({ _id: otherTrip, inviteCode: hex(otherTrip), visibility: "public", votingEnabled: false, expenseMode: "register" });
      await f.db.collection("tripMembers").insertOne({ tripId: otherTrip, userId: outsider, role: "participant", joinedAt: new Date() });
      const inOtherTrip = await f.request("POST", `/trips/${hex(otherTrip)}/posts`, body, outsider);
      expect(byOther.statusCode).toBe(409);
      expect(inOtherTrip.statusCode).toBe(409);
      expect(JSON.parse(byOther.body)).toEqual(JSON.parse(inOtherTrip.body));
      expect(byOther.body).not.toContain(hex(f.actor));
      expect(JSON.parse(byOther.body).error).toEqual({ code: "PostRequestConflictError", message: expect.any(String) });
      expect(await counts()).toMatchObject({ posts: 1 });
      expect(await f.db.collection("posts").countDocuments({ tripId: otherTrip })).toBe(0);
    });

    it.each([["short", "abc"], ["uppercase", "A".repeat(24)], ["number", 123], ["null", null], ["empty", ""], ["object", {}]])(
      "rejects an invalid post id (%s) with 422 field id/invalid and no writes", async (_, id) => {
        const before = await data();
        const response = await post({ id, description: "x" });
        expect(response.statusCode, response.body).toBe(422);
        expect(JSON.parse(response.body).error.fields ?? JSON.parse(response.body).error.issues).toEqual(expect.arrayContaining([expect.objectContaining({ field: "id", code: "invalid" })]));
        expect(await data()).toEqual(before);
      });

    it("a confirmation_required is not stored: the same id after confirming creates the post once", async () => {
      await seedActivity("Plan A", "2026-09-25T12:30:00Z");
      const body = { id: newId(), description: "Cena", newActivity: withDuration() };
      const refused = await post(body);
      expect(refused.statusCode).toBe(409);
      expect(await f.db.collection("posts").countDocuments({ _id: new ObjectId(body.id) })).toBe(0);
      const again = await post(body);
      expect(again.statusCode).toBe(409);
      const { conflicts, activity } = JSON.parse(refused.body).error;
      const confirmed = await post({ ...body, confirmedConflicts: conflicts, confirmedActivity: activity });
      expect(confirmed.statusCode, confirmed.body).toBe(201);
      expect(JSON.parse((await post({ ...body, confirmedConflicts: conflicts, confirmedActivity: activity })).body)).toEqual(JSON.parse(confirmed.body));
      expect(await counts()).toMatchObject({ posts: 1, activities: 2 });
    });

    it("a failed save leaves nothing and the id stays free for the retry", async () => {
      const body = { id: newId(), description: "Cena", newActivity: withDuration(), photos: photoRefs(1) };
      const before = await data();
      const collection = f.db.collection("activityParticipations"), original = f.db.collection.bind(f.db);
      vi.spyOn(collection, "findOneAndUpdate").mockRejectedValueOnce(new Error("forced failure"));
      vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === "activityParticipations" ? collection : original(key, options));
      expect((await post(body)).statusCode).toBe(500);
      expect(await data()).toEqual(before);
      vi.restoreAllMocks();
      const retry = await post(body);
      expect(retry.statusCode, retry.body).toBe(201);
      expect(await counts()).toMatchObject({ posts: 1, activities: 1, postPhotos: 1 });
    });

    describe("11000 race on a client id taken between the check and the insert", () => {
      const otherTripWith = async () => {
        const otherTrip = new ObjectId();
        await f.db.collection("trips").insertOne({ _id: otherTrip, inviteCode: hex(otherTrip), visibility: "public", votingEnabled: false, expenseMode: "register" });
        return otherTrip;
      };

      it("a post id that another Trip took after the owner check is the generic 409 (not 500) and nothing is written", async () => {
        const id = newId(), otherTrip = await otherTripWith();
        await f.db.collection("posts").insertOne({ _id: new ObjectId(id), tripId: otherTrip, authorId: new ObjectId(), createdAt: new Date(), description: "Ajeno",
          mapsUrl: null, activityId: null, parentPostId: null, transportId: null });
        // The owner lookup (the only findOne with a projection) answers "free", as if the other Trip's insert came after it.
        const collection = f.db.collection("posts"), original = f.db.collection.bind(f.db), realFindOne = collection.findOne.bind(collection) as (...args: unknown[]) => Promise<unknown>;
        vi.spyOn(collection, "findOne").mockImplementation(((filter: unknown, options?: { projection?: unknown }) =>
          options?.projection === undefined ? realFindOne(filter, options) : Promise.resolve(null)) as never);
        vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === "posts" ? collection : original(key, options));
        const before = await data();
        const response = await post({ id, description: "Mio" });
        expect(response.statusCode, response.body).toBe(409);
        expect(JSON.parse(response.body).error).toEqual({ code: "PostRequestConflictError", message: expect.any(String) });
        expect(await data()).toEqual(before);
      });

      it("a new activity id that another Trip owns is the generic 409 (not 500) and nothing is written", async () => {
        const created = JSON.parse((await post({ description: "Original" })).body).post, id = newId(), otherTrip = await otherTripWith();
        await f.db.collection("activities").insertOne({ _id: new ObjectId(id), tripId: otherTrip, title: "Ajena" });
        const before = await data();
        const response = await patch(created.id, { newActivity: { ...withDuration(), id } });
        expect(response.statusCode, response.body).toBe(409);
        expect(JSON.parse(response.body).error).toEqual({ code: "PostRequestConflictError", message: expect.any(String) });
        expect(await data()).toEqual(before);
      });

      // listActivities is per Trip, so another Trip's activity id is invisible to the pre-check: validation and agenda review run first and the
      // generic 409 only comes from the insert. These fix the real answers before that point (no writes, no reason, no owner revealed).
      it("a new activity id owned by another Trip with an agenda conflict answers the confirmation 409 (ParticipationConflictError), without reason or writes", async () => {
        const created = JSON.parse((await post({ description: "Original" })).body).post, id = newId(), otherTrip = await otherTripWith();
        await seedActivity("Plan A", "2026-09-25T12:30:00Z");
        await f.db.collection("activities").insertOne({ _id: new ObjectId(id), tripId: otherTrip, title: "Ajena" });
        const before = await data();
        for (const response of [await patch(created.id, { newActivity: { ...withDuration(), id } }), await post({ description: "Nuevo", newActivity: { ...withDuration(), id } })]) {
          expect(response.statusCode, response.body).toBe(409);
          const error = JSON.parse(response.body).error;
          expect(error.code).toBe("ParticipationConflictError");
          expect(error).not.toHaveProperty("reason");
          expect(response.body).not.toContain(hex(otherTrip));
        }
        expect(await data()).toEqual(before);
      });

      it("a new activity id owned by another Trip outside the destination window answers 422 without reason or writes", async () => {
        const created = JSON.parse((await post({ description: "Original" })).body).post, id = newId(), otherTrip = await otherTripWith();
        await f.db.collection("activities").insertOne({ _id: new ObjectId(id), tripId: otherTrip, title: "Ajena" });
        const before = await data();
        const outside = { title: "Cena", scheduledAt: "2030-01-01T12:00:00Z", durationMinutes: 60, id };
        for (const response of [await patch(created.id, { newActivity: outside }), await post({ description: "Nuevo", newActivity: outside })]) {
          expect(response.statusCode, response.body).toBe(422);
          const error = JSON.parse(response.body).error;
          expect(error.code).toBe("ValidationError");
          expect(error).not.toHaveProperty("reason");
          expect(response.body).not.toContain(hex(otherTrip));
        }
        expect(await data()).toEqual(before);
      });
    });

    describe("PATCH with newActivity.id", () => {
      it("a retry with the same id answers the same 200 without a second activity or participation", async () => {
        const created = JSON.parse((await post({ description: "Original" })).body).post;
        const body = { description: "Editado", newActivity: { ...withDuration(), id: newId() }, photos: photoRefs(1) };
        const first = await patch(created.id, body);
        expect(first.statusCode, first.body).toBe(200);
        expect(JSON.parse(first.body).activity.id).toBe(body.newActivity.id);
        const before = await data();
        const retry = await patch(created.id, body);
        expect(retry.statusCode, retry.body).toBe(200);
        expect(JSON.parse(retry.body)).toEqual(JSON.parse(first.body));
        expect(await data()).toEqual(before);
        expect(await counts()).toMatchObject({ posts: 1, activities: 1, activityParticipations: 1, postPhotos: 1 });
      });

      it("the same id with another activity is 409 without writes; an invalid id is 422", async () => {
        const created = JSON.parse((await post({ description: "Original" })).body).post;
        const id = newId();
        expect((await patch(created.id, { newActivity: { ...withDuration(), id } })).statusCode).toBe(200);
        const before = await data();
        const different = await patch(created.id, { newActivity: { ...withDuration(), id, title: "Otra" } });
        expect(different.statusCode, different.body).toBe(409);
        expect(JSON.parse(different.body).error).toMatchObject({ code: "PostRequestConflictError", reason: "already_saved", postId: created.id });
        for (const bad of ["xyz", "B".repeat(24), 5, null]) {
          const response = await patch(created.id, { newActivity: { ...withDuration(), id: bad } });
          expect(response.statusCode, response.body).toBe(422);
        }
        expect(await data()).toEqual(before);
      });

      it("an exact PATCH retry with a partial expense ({ breakdown }) answers 200 with what is stored; another value is 409 already_saved", async () => {
        const [ana, beto] = [await addMember("participant"), await addMember("participant")];
        const created = JSON.parse((await post({ description: "Original", expense: await expenseOf([ana, beto]) })).body).post;
        const body = { newActivity: { ...withDuration(), id: newId() }, expense: { breakdown: "agua" } };
        const first = await patch(created.id, body);
        expect(first.statusCode, first.body).toBe(200);
        expect(JSON.parse(first.body).expense).toMatchObject({ breakdown: "agua", payments: expect.any(Array) });
        const before = await data();
        const retry = await patch(created.id, body);
        expect(retry.statusCode, retry.body).toBe(200);
        expect(JSON.parse(retry.body)).toEqual(JSON.parse(first.body));
        const other = await patch(created.id, { ...body, expense: { breakdown: "otro" } });
        expect(other.statusCode, other.body).toBe(409);
        expect(JSON.parse(other.body).error).toMatchObject({ reason: "already_saved", postId: created.id });
        expect(await data()).toEqual(before);
      });

      it("the retry after someone relinked the post to another activity is 409 already_saved; an id of another creator stays generic", async () => {
        const editor = await addMember("admin");
        const created = JSON.parse((await post({ description: "Original" })).body).post;
        const body = { newActivity: { ...withDuration(), id: newId() } };
        expect((await patch(created.id, body)).statusCode).toBe(200);
        const relinked = await patch(created.id, { newActivity: { title: "Otra", scheduledAt: "2026-09-25T15:00:00.000Z", durationMinutes: 60 } }, editor);
        expect(relinked.statusCode, relinked.body).toBe(200);
        const before = await data();
        const retry = await patch(created.id, body);
        expect(retry.statusCode, retry.body).toBe(409);
        expect(JSON.parse(retry.body).error).toMatchObject({ code: "PostRequestConflictError", reason: "already_saved", postId: created.id });
        expect(await data()).toEqual(before);
        const second = JSON.parse((await post({ description: "Segundo" })).body).post;
        const foreign = { newActivity: { ...withDuration(), id: newId(), title: "Del editor" } };
        expect((await patch(second.id, foreign, editor)).statusCode).toBe(200);
        const beforeForeign = await data();
        const mine = await patch(created.id, foreign);
        expect(mine.statusCode, mine.body).toBe(409);
        expect(JSON.parse(mine.body).error).not.toHaveProperty("reason");
        expect(await f.db.collection("posts").countDocuments({})).toBe(2);
        expect(await data()).toEqual(beforeForeign);
      });

      it("a post already linked to an activity with that id created by ANOTHER member is a generic 409 without reason and without writes", async () => {
        const editor = await addMember("admin");
        const created = JSON.parse((await post({ description: "Original" })).body).post;
        const second = JSON.parse((await post({ description: "Segundo" })).body).post;
        const foreign = { newActivity: { ...withDuration(), id: newId(), title: "Del editor" } };
        const made = await patch(second.id, foreign, editor);
        expect(made.statusCode, made.body).toBe(200);
        const activityId = JSON.parse(made.body).post.activityId;
        const activity = await f.db.collection("activities").findOne({});
        await f.db.collection("posts").updateOne({ _id: await f.db.collection("posts").findOne({ description: "Original" }).then((doc) => doc!._id) },
          { $set: { activityId: activity!._id } });
        const before = await data();
        const mine = await patch(created.id, { newActivity: { ...foreign.newActivity, id: activityId } });
        expect(mine.statusCode, mine.body).toBe(409);
        expect(JSON.parse(mine.body).error).not.toHaveProperty("reason");
        expect(await data()).toEqual(before);
      });

      it("without id on an already linked post it still creates another activity and repoints (documented ambiguity)", async () => {
        const created = JSON.parse((await post({ description: "Original", newActivity: withDuration() })).body).post;
        const response = await patch(created.id, { newActivity: { title: "Otra", scheduledAt: "2026-09-25T15:00:00.000Z", durationMinutes: 60 } });
        expect(response.statusCode, response.body).toBe(200);
        expect(await counts()).toMatchObject({ posts: 1, activities: 2 });
        expect(JSON.parse(response.body).post.activityId).not.toBe(created.activityId);
      });
    });
  });

  describe("concurrency", () => {
    // The first call of `method` on `name` runs for real and then stays paused (transaction open, Trip lock taken) until released.
    const pauseAfterFirst = (name: string, method: "insertOne" | "updateOne" | "findOne") => {
      const collection = f.db.collection(name), original = f.db.collection.bind(f.db);
      const real = (collection[method] as (...args: unknown[]) => Promise<unknown>).bind(collection);
      let reached!: () => void, release!: () => void, first = true;
      const reachedPromise = new Promise<void>((resolve) => { reached = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      pendingReleases.push(() => release());
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`The first ${name}.${method} never ran.`)), 3_000); });
      const reachedOrTimeout = Promise.race([reachedPromise, timeout]).finally(() => clearTimeout(timer));
      reachedOrTimeout.catch(() => undefined);
      vi.spyOn(collection, method).mockImplementation((async (...args: unknown[]) => {
        const result = await real(...args);
        if (first) { first = false; reached(); await gate; }
        return result;
      }) as never);
      vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === name ? collection : original(key, options));
      return { reached: reachedOrTimeout, release: () => release() };
    };
    // The journey repository keeps the collections it got when the API was built, so the Trip lock of a transport edit is paused on the
    // driver's prototype (filtered by collection name) instead of on `f.db.collection`.
    const pauseTripLock = () => {
      const proto = Object.getPrototypeOf(f.db.collection("trips")) as { updateOne: (...args: unknown[]) => Promise<unknown> };
      const real = proto.updateOne;
      let reached!: () => void, release!: () => void, first = true;
      const reachedPromise = new Promise<void>((resolve) => { reached = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      pendingReleases.push(() => release());
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("The first trips.updateOne never ran.")), 3_000); });
      const reachedOrTimeout = Promise.race([reachedPromise, timeout]).finally(() => clearTimeout(timer));
      reachedOrTimeout.catch(() => undefined);
      vi.spyOn(proto, "updateOne").mockImplementation((async function (this: { collectionName: string }, ...args: unknown[]) {
        const result = await real.apply(this, args);
        if (first && this.collectionName === "trips") { first = false; reached(); await gate; }
        return result;
      }) as never);
      return { reached: reachedOrTimeout, release: () => release() };
    };
    const launch = <T>(promise: Promise<T>) => { launched.push(promise); return promise; };
    const track = <T>(promise: Promise<T>) => { const state = { settled: false }; void promise.finally(() => { state.settled = true; }); return state; };
    const concurrent = (name: string, fn: () => Promise<void>) => it(name, fn, 15_000);
    const pause = () => new Promise((resolve) => setTimeout(resolve, 500));

    concurrent("two simultaneous POSTs with the same id and body: one creates, the other answers as a retry; one of each record", async () => {
      const body = { id: newId(), description: "Cena", newActivity: withDuration(), photos: photoRefs(1) };
      const paused = pauseAfterFirst("posts", "insertOne");
      const first = launch(post(body));
      let second!: ReturnType<typeof post>;
      try {
        await paused.reached;
        second = launch(post(body)); const secondState = track(second);
        await pause();
        expect(secondState.settled, "the second POST finished while the first transaction was open").toBe(false);
      } finally { paused.release(); }
      const results = await Promise.allSettled([first, second]);
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
      const [a, b] = results.map((r) => (r as PromiseFulfilledResult<Awaited<typeof first>>).value);
      expect([a!.statusCode, b!.statusCode]).toEqual([201, 201]);
      expect(JSON.parse(b!.body)).toEqual(JSON.parse(a!.body));
      expect(await counts()).toMatchObject({ posts: 1, activities: 1, activityParticipations: 1, postPhotos: 1 });
    });

    concurrent("two simultaneous POSTs with the same id and different bodies: one 201 and one 409, nothing duplicated or unmapped", async () => {
      const id = newId();
      const paused = pauseAfterFirst("posts", "insertOne");
      const first = launch(post({ id, description: "Uno" }));
      let second!: ReturnType<typeof post>;
      try {
        await paused.reached;
        second = launch(post({ id, description: "Dos" })); const secondState = track(second);
        await pause();
        expect(secondState.settled, "the second POST finished while the first transaction was open").toBe(false);
      } finally { paused.release(); }
      const [a, b] = await Promise.all([first, second]);
      expect([a.statusCode, b.statusCode]).toEqual([201, 409]);
      expect(JSON.parse(b.body).error).toMatchObject({ code: "PostRequestConflictError", reason: "already_saved", postId: id });
      expect(await f.db.collection("posts").find({ _id: new ObjectId(id) }).toArray()).toMatchObject([{ description: "Uno" }]);
      expect(await f.db.collection("posts").countDocuments({})).toBe(1);
    });

    concurrent("a POST with a new activity and an expulsion of its author: the expulsion waits for the save, which stays whole", async () => {
      const admin = await addMember("admin"); await f.releaseOwnership();
      const paused = pauseAfterFirst("activities", "insertOne");
      const saving = launch(post({ id: newId(), description: "Cena", newActivity: withDuration(), photos: photoRefs(1) }));
      let expelling!: Promise<{ ok: boolean }>;
      try {
        await paused.reached;
        expelling = launch(f.api.expelMember!({ tripId: domainId(f.trip), actorUserId: domainId(admin), targetUserId: domainId(f.actor) })); const expulsion = track(expelling);
        await pause();
        expect(expulsion.settled, "the expulsion finished while the save transaction was open").toBe(false);
      } finally { paused.release(); }
      const [saved, expelled] = await Promise.all([saving, expelling]);
      expect(saved.statusCode, saved.body).toBe(201);
      expect(expelled.ok).toBe(true);
      expect(await counts()).toMatchObject({ posts: 1, activities: 1, postPhotos: 1 });
      expect(await f.db.collection("tripMembers").countDocuments({ userId: f.actor })).toBe(0);
    });

    concurrent("an expulsion that wins the lock makes the joint save answer 404 and write nothing", async () => {
      const admin = await addMember("admin"); await f.releaseOwnership();
      const paused = pauseAfterFirst("trips", "updateOne");
      const expelling = launch(f.api.expelMember!({ tripId: domainId(f.trip), actorUserId: domainId(admin), targetUserId: domainId(f.actor) }));
      let saving!: ReturnType<typeof post>;
      try {
        await paused.reached;
        saving = launch(post({ id: newId(), description: "Cena", newActivity: withDuration(), photos: photoRefs(1) })); const save = track(saving);
        await pause();
        expect(save.settled, "the save finished while the expulsion transaction was open").toBe(false);
      } finally { paused.release(); }
      const [expelled, saved] = await Promise.all([expelling, saving]);
      expect(expelled.ok).toBe(true);
      expect(saved.statusCode).toBe(404);
      expect(await counts()).toEqual({ posts: 0, activities: 0, activityParticipations: 0, postPhotos: 0, postExpenses: 0 });
    });

    concurrent("another member's agenda change during the save: both are kept and the author's plan only changes in the author's agenda", async () => {
      const other = await addMember("participant");
      const existing = await seedActivity("Plan A", "2026-09-25T15:00:00Z");
      const paused = pauseAfterFirst("activities", "insertOne");
      const saving = launch(post({ id: newId(), description: "Cena", newActivity: withDuration() }));
      let changing!: Promise<{ ok: boolean }>;
      try {
        await paused.reached;
        changing = launch(f.api.setActivityParticipation!({ ...f.context(), authenticatedUserId: domainId(other), activityId: domainId(new ObjectId(existing)), status: "going" } as never));
        await pause();
      } finally { paused.release(); }
      const [saved, changed] = await Promise.all([saving, changing]);
      expect(saved.statusCode, saved.body).toBe(201);
      expect(changed.ok, JSON.stringify(changed)).toBe(true);
      const mine = await f.db.collection("activityParticipations").find({ userId: f.actor }).toArray();
      expect(mine).toHaveLength(2);
      expect(mine.every((p) => p.status === "going")).toBe(true);
      expect(await f.db.collection("activityParticipations").find({ userId: other }).toArray()).toMatchObject([{ status: "going" }]);
      expect(await counts()).toMatchObject({ posts: 1, activities: 2 });
    });

    concurrent("a transport edit that would orphan the new activity waits for the save and is then rejected, keeping one post and one activity", async () => {
      const outbound = await f.configureTransports();
      const paused = pauseAfterFirst("activities", "insertOne");
      const saving = launch(post({ id: newId(), description: "Cena", newActivity: withDuration() }));
      let editing!: Promise<{ ok: boolean }>;
      try {
        await paused.reached;
        editing = launch(f.api.updateTransport!({ ...f.context(), destinationId: domainId(f.destination), transportId: outbound.id,
          arrivalAt: new Date("2026-09-25T14:00:00Z") }));
        await pause();
      } finally { paused.release(); }
      const [saved, edited] = await Promise.all([saving, editing]);
      expect(saved.statusCode, saved.body).toBe(201);
      expect(edited.ok, "the transport edit left the saved activity outside its window").toBe(false);
      expect(await counts()).toMatchObject({ posts: 1, activities: 1, activityParticipations: 1 });
    });

    concurrent("a transport edit that wins the lock makes the save with the new activity fail without writing", async () => {
      const outbound = await f.configureTransports();
      const paused = pauseTripLock();
      const editing = launch(f.api.updateTransport!({ ...f.context(), destinationId: domainId(f.destination), transportId: outbound.id,
        arrivalAt: new Date("2026-09-25T14:00:00Z") }));
      let saving!: ReturnType<typeof post>;
      try {
        await paused.reached;
        saving = launch(post({ id: newId(), description: "Cena", newActivity: withDuration() }));
        await pause();
      } finally { paused.release(); }
      const [edited, saved] = await Promise.all([editing, saving]);
      expect(edited.ok, JSON.stringify(edited)).toBe(true);
      expect(saved.statusCode, saved.body).toBe(422);
      expect(await counts()).toEqual({ posts: 0, activities: 0, activityParticipations: 0, postPhotos: 0, postExpenses: 0 });
    });
  });
});
