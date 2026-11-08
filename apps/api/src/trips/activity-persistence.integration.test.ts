import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createObjectId, type Activity, type ObjectId as DomainId } from "app-domain";
import { createTripApi } from "./trip-api.js";
import type { TripApi } from "../app.js";
import { migrateMongoSchema } from "../adapters/mongodb/migrations.js";

const id = (v: ObjectId): DomainId => {
  const result = createObjectId(v.toHexString());
  if (!result.ok) throw result.error;
  return result.value;
};
describe("activity persistence and transactions", () => {
  let server: MongoMemoryReplSet, client: MongoClient, db: Db, api: TripApi;
  let trip: ObjectId, actor: ObjectId, destination: ObjectId, day: ObjectId;
  const occurrence = new Date("2026-09-25T12:00:00.456Z");
  const context = () => ({ tripId: id(trip), authenticatedUserId: id(actor) });
  const input = () => ({ ...context(), dayId: id(day), title: "Paseo", scheduledAt: occurrence });
  const create = async (): Promise<Activity> => {
    expect(api.createActivity).toBeTypeOf("function");
    const result = await api.createActivity!(input());
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw result.error;
    if (result.value.outcome !== "created") throw new Error("Activity not created.");
    return result.value.activity;
  };
  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = new MongoClient(server.getUri()); await client.connect();
    db = client.db("activity_persistence"); await migrateMongoSchema(db);
  }, 120_000);
  afterAll(async () => { await client?.close(); await server?.stop(); });
  beforeEach(async () => {
    vi.restoreAllMocks();
    for (const name of ["trips", "tripMembers", "destinations", "itineraryDays", "activities", "activityVotes", "activityParticipations",
      "posts", "postExpenses", "postPhotos", "comments", "postLikes", "commentLikes", "transports"]) await db.collection(name).deleteMany({});
    trip = new ObjectId(); actor = new ObjectId(); destination = new ObjectId(); day = new ObjectId();
    await db.collection("trips").insertOne({ _id: trip, inviteCode: trip.toHexString(), votingEnabled: false, expenseMode: "register", visibility: "public" });
    await db.collection("tripMembers").insertOne({ tripId: trip, userId: actor, role: "participant", joinedAt: new Date() });
    await db.collection("destinations").insertOne({ _id: destination, tripId: trip, name: "Córdoba", order: 1, createdAt: new Date() });
    await db.collection("itineraryDays").insertOne({ _id: day, tripId: trip, destinationId: destination, type: "activity", order: 1,
      date: new Date("2026-09-25T00:00:00Z"), startsAt: new Date("2026-09-25T10:00:00.123Z"), endsAt: new Date("2026-09-25T18:00:00.789Z") });
    api = createTripApi(db);
  });

  it.each(["admin", "participant"])("persists BSON values and allows CRUD by %s, including another author's activity", async (role) => {
    await db.collection("tripMembers").updateOne({ tripId: trip }, { $set: { role } });
    const activity = await create();
    expect(activity).toMatchObject({ tripId: id(trip), createdBy: id(actor), scheduledAt: occurrence, description: null, mapsUrl: null });
    const stored = await db.collection("activities").findOne({ _id: new ObjectId(activity.id) });
    expect(stored).toMatchObject({ tripId: trip, dayId: day, createdBy: actor, scheduledAt: occurrence });
    expect(stored!.createdAt).toBeInstanceOf(Date);
    await db.collection("activities").updateOne({ _id: stored!._id }, { $set: { createdBy: new ObjectId(), status: "voting" } });
    const result = await api.updateActivity!({ ...context(), activityId: activity.id, title: "Museo", description: "Centro" });
    expect(result).toMatchObject({ ok: true, value: { activity: { title: "Museo", description: "Centro", createdAt: activity.createdAt } } });
    expect(await api.getActivity!({ ...context(), activityId: activity.id })).toEqual({ ok: true, value: (result as { value: { activity: Activity } }).value.activity });
    expect(await api.listActivities!(context())).toMatchObject({ ok: true, value: [{ title: "Museo" }] });
    expect(await api.deleteActivity!({ ...context(), activityId: activity.id })).toMatchObject({ ok: true });
    expect(await db.collection("activities").countDocuments({ tripId: trip })).toBe(0);
  });

  it("ignores historical voting configuration and preserves UTC milliseconds", async () => {
    await db.collection("trips").updateOne({ _id: trip }, { $set: { votingEnabled: true } });
    const activity = await create();
    expect(activity).not.toHaveProperty("status");
    expect(activity.scheduledAt.toISOString()).toBe("2026-09-25T12:00:00.456Z");
  });

  it("hides public Trip activities from external and expelled users on every operation", async () => {
    const activity = await create();
    const before = await db.collection("activities").find().toArray();
    await db.collection("tripMembers").deleteMany({ tripId: trip });
    for (const result of [await api.createActivity!(input()), await api.listActivities!(context()),
      await api.getActivity!({ ...context(), activityId: activity.id }),
      await api.updateActivity!({ ...context(), activityId: activity.id, title: "No" }),
      await api.deleteActivity!({ ...context(), activityId: activity.id })]) {
      expect(result).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    }
    expect(await db.collection("activities").find().toArray()).toEqual(before);
  });

  it("scopes activity IDs to the requested Trip and lists only its records", async () => {
    const activity = await create();
    const foreignTrip = new ObjectId(), foreignActivity = new ObjectId();
    const stored = await db.collection("activities").findOne({ _id: new ObjectId(activity.id) });
    await db.collection("activities").insertOne({ ...stored!, _id: foreignActivity, tripId: foreignTrip });
    for (const result of [await api.getActivity!({ ...context(), activityId: id(foreignActivity) }),
      await api.updateActivity!({ ...context(), activityId: id(foreignActivity), title: "No" }),
      await api.deleteActivity!({ ...context(), activityId: id(foreignActivity) })]) {
      expect(result).toMatchObject({ ok: false, error: { tag: "ActivityNotFoundError" } });
    }
    expect(await api.listActivities!(context())).toEqual({ ok: true, value: [activity] });
    expect(await db.collection("activities").countDocuments()).toBe(2);
  });

  it("preserves historical votes, deletes participations and detaches posts", async () => {
    const activity = await create(); const activityId = new ObjectId(activity.id), otherActivity = new ObjectId();
    const postId = new ObjectId(), parentPostId = new ObjectId(), transportId = new ObjectId();
    await db.collection("posts").insertOne({ _id: postId, tripId: trip, dayId: day, authorId: actor, activityId, parentPostId, transportId,
      description: "Recuerdo", mapsUrl: null, createdAt: occurrence });
    // The author's going created with the activity is replaced by the fixture below.
    await db.collection("activityParticipations").deleteMany({});
    for (const name of ["activityVotes", "activityParticipations"]) {
      await db.collection(name).insertMany([{ activityId, tripId: trip, userId: actor }, { activityId: otherActivity, tripId: trip, userId: actor },
        { activityId, tripId: new ObjectId(), userId: new ObjectId() }]);
    }
    const preserved: Record<string, unknown[]> = {};
    for (const name of ["postExpenses", "postPhotos", "comments", "postLikes", "commentLikes"]) {
      await db.collection(name).insertOne({ postId, tripId: trip, value: "preserved" });
      preserved[name] = await db.collection(name).find().toArray();
    }
    expect(await api.deleteActivity!({ ...context(), activityId: activity.id })).toEqual({ ok: true, value: undefined });
    expect(await db.collection("posts").findOne({ _id: postId })).toMatchObject({ activityId: null, tripId: trip, dayId: day, parentPostId, transportId,
      description: "Recuerdo", createdAt: occurrence });
    for (const name of ["activityVotes", "activityParticipations"]) {
      expect(await db.collection(name).countDocuments({ tripId: trip, activityId })).toBe(name === "activityVotes" ? 1 : 0);
      expect(await db.collection(name).countDocuments()).toBe(name === "activityVotes" ? 3 : 2);
    }
    for (const [name, before] of Object.entries(preserved)) expect(await db.collection(name).find().toArray()).toEqual(before);
    expect(await api.deleteActivity!({ ...context(), activityId: activity.id })).toMatchObject({ ok: false, error: { tag: "ActivityNotFoundError" } });
  });

  it("rolls back detached posts and preserves votes when deleting participations fails", async () => {
    const activity = await create(), activityId = new ObjectId(activity.id);
    await db.collection("posts").insertOne({ tripId: trip, activityId });
    await db.collection("activityVotes").insertOne({ tripId: trip, activityId, userId: actor });
    const before = await Promise.all(["trips", "activities", "posts", "activityVotes"].map((name) => db.collection(name).find().toArray()));
    const collection = db.collection("activityParticipations");
    vi.spyOn(collection, "deleteMany").mockRejectedValueOnce(new Error("forced failure"));
    const original = db.collection.bind(db);
    vi.spyOn(db, "collection").mockImplementation((name, options) => name === "activityParticipations" ? collection : original(name, options));
    expect(await api.deleteActivity!({ ...context(), activityId: activity.id })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
    expect(await Promise.all(["trips", "activities", "posts", "activityVotes"].map((name) => db.collection(name).find().toArray()))).toEqual(before);
  });

  it("rejects invalid edits without changing data or the Trip coordination revision", async () => {
    const activity = await create();
    const before = await Promise.all(["trips", "activities"].map((name) => db.collection(name).find().toArray()));
    expect(await api.updateActivity!({ ...context(), activityId: activity.id, scheduledAt: new Date("2026-09-25T09:00:00Z") }))
      .toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(await Promise.all(["trips", "activities"].map((name) => db.collection(name).find().toArray()))).toEqual(before);
  });

  it("GET operations preserve the Trip coordination revision", async () => {
    const activity = await create(); const before = await db.collection("trips").findOne({ _id: trip });
    await api.listActivities!(context()); await api.getActivity!({ ...context(), activityId: activity.id });
    expect(await db.collection("trips").findOne({ _id: trip })).toEqual(before);
  });

  it("serializes creation with Trip deletion without orphaning content", async () => {
    expect(api.createActivity).toBeTypeOf("function");
    await db.collection("tripMembers").updateOne({ tripId: trip }, { $set: { role: "admin" } });
    const [created, deleted] = await Promise.all([api.createActivity!(input()), api.delete!(context())]);
    expect(deleted.ok).toBe(true);
    expect(created.ok || (!created.ok && created.error.tag === "TripNotFoundError")).toBe(true);
    expect(await db.collection("activities").countDocuments({ tripId: trip })).toBe(0);
    expect(await db.collection("trips").countDocuments({ _id: trip })).toBe(0);
  });

  const configureTransports = async () => {
    const base = { ...context(), destinationId: id(destination), type: "car" as const, departurePlace: "Origen", arrivalPlace: "Destino",
      costPerPerson: null, details: {} };
    const outbound = await api.createTransport!({ ...base, direction: "outbound", departureAt: new Date("2026-09-25T08:00:00Z"),
      arrivalAt: new Date("2026-09-25T10:00:00.123Z") });
    const returning = await api.createTransport!({ ...base, direction: "return", departureAt: new Date("2026-09-25T18:00:00.789Z"),
      arrivalAt: new Date("2026-09-25T20:00:00Z") });
    expect(outbound.ok).toBe(true); expect(returning.ok).toBe(true);
    if (!outbound.ok) throw outbound.error;
    // Completing both transports creates the canonical activity slice.
    const canonical = await db.collection("itineraryDays").findOne({ tripId: trip, type: "activity" });
    expect(canonical).not.toBeNull();
    day = canonical!._id;
    return outbound.value;
  };

  it("protects activities created by T36 from incompatible transport edits until they are deleted", async () => {
    const outbound = await configureTransports();
    const activity = await create();
    const patch = { ...context(), destinationId: id(destination), transportId: outbound.id, arrivalAt: new Date("2026-09-25T13:00:00Z") };
    expect(await api.updateTransport!(patch)).toMatchObject({ ok: false, error: { tag: "ItineraryConflictError" } });
    expect(await api.getActivity!({ ...context(), activityId: activity.id })).toEqual({ ok: true, value: activity });
    expect(await api.deleteActivity!({ ...context(), activityId: activity.id })).toMatchObject({ ok: true });
    expect(await api.updateTransport!(patch)).toMatchObject({ ok: true });
  });

  it("serializes simultaneous activity creation and an incompatible transport change", async () => {
    const outbound = await configureTransports();
    const [created, changed] = await Promise.all([api.createActivity!(input()), api.updateTransport!({ ...context(), destinationId: id(destination),
      transportId: outbound.id, arrivalAt: new Date("2026-09-25T13:00:00Z") })]);
    expect(created.ok && changed.ok).toBe(false);
    expect(created.ok || changed.ok).toBe(true);
    if (!created.ok) expect(created.error.tag).toBe("ValidationError");
    if (!changed.ok) expect(changed.error.tag).toBe("ItineraryConflictError");
    const stored = await db.collection("activities").find({ tripId: trip }).toArray();
    const persistedDay = await db.collection("itineraryDays").findOne({ _id: day });
    for (const activity of stored) {
      expect(activity.dayId).toEqual(day);
      expect(activity.scheduledAt.getTime()).toBeGreaterThanOrEqual(persistedDay!.startsAt.getTime());
      expect(activity.scheduledAt.getTime()).toBeLessThanOrEqual(persistedDay!.endsAt.getTime());
    }
  });

  describe("duration", () => {
    it("stores and reads durationMinutes and keeps millisecond start when editing content", async () => {
      const result = await api.createActivity!({ ...input(), durationMinutes: 90 });
      expect(result).toMatchObject({ ok: true, value: { outcome: "created", activity: { durationMinutes: 90, scheduledAt: occurrence } } });
      if (!result.ok || result.value.outcome !== "created") throw new Error("Activity not created.");
      expect(await db.collection("activities").findOne({ _id: new ObjectId(result.value.activity.id) }))
        .toMatchObject({ durationMinutes: 90, scheduledAt: occurrence });
      const edited = await api.updateActivity!({ ...context(), activityId: result.value.activity.id, title: "Museo" });
      expect(edited).toMatchObject({ ok: true, value: { activity: { durationMinutes: 90 } } });
      const stored = await db.collection("activities").findOne({ _id: new ObjectId(result.value.activity.id) });
      expect(stored!.scheduledAt.toISOString()).toBe("2026-09-25T12:00:00.456Z");
      expect(stored).toMatchObject({ durationMinutes: 90, title: "Museo" });
      expect(await api.updateActivity!({ ...context(), activityId: result.value.activity.id, durationMinutes: null }))
        .toMatchObject({ ok: true, value: { activity: { durationMinutes: null } } });
      expect(await db.collection("activities").findOne({ _id: new ObjectId(result.value.activity.id) })).toMatchObject({ durationMinutes: null });
    });

    it("stores null when created without duration", async () => {
      const activity = await create();
      expect(activity.durationMinutes).toBeNull();
      expect(await db.collection("activities").findOne({ _id: new ObjectId(activity.id) })).toMatchObject({ durationMinutes: null });
    });

    it("reads a legacy document without the field as null", async () => {
      const legacy = new ObjectId();
      await db.collection("activities").insertOne({ _id: legacy, tripId: trip, dayId: day, title: "Legado", description: null,
        scheduledAt: occurrence, mapsUrl: null, createdBy: actor, createdAt: new Date("2026-09-01T00:00:00Z") });
      expect(await api.getActivity!({ ...context(), activityId: id(legacy) })).toMatchObject({ ok: true, value: { durationMinutes: null } });
      expect(await api.listActivities!(context())).toMatchObject({ ok: true, value: [{ durationMinutes: null }] });
    });

    it("writes nothing when the end exceeds the destination window", async () => {
      expect(await api.createActivity!({ ...input(), durationMinutes: 400 }))
        .toMatchObject({ ok: false, error: { tag: "ValidationError" } });
      expect(await db.collection("activities").countDocuments()).toBe(0);
      const activity = await create(), before = await db.collection("activities").find().toArray();
      expect(await api.updateActivity!({ ...context(), activityId: activity.id, durationMinutes: 400 }))
        .toMatchObject({ ok: false, error: { tag: "ValidationError" } });
      expect(await db.collection("activities").find().toArray()).toEqual(before);
    });
  });

  describe("author participation (T52)", () => {
    const other = () => new ObjectId();
    const at = (iso: string) => new Date(iso);
    const seedGoing = async (start: string, duration: number | null, status = "going", user = actor) => {
      const _id = new ObjectId();
      await db.collection("activities").insertOne({ _id, tripId: trip, dayId: day, title: "Previo", description: null, scheduledAt: at(start),
        durationMinutes: duration, mapsUrl: null, createdBy: other(), createdAt: new Date() });
      await db.collection("activityParticipations").insertOne({ _id: new ObjectId(), tripId: trip, activityId: _id, userId: user, status,
        updatedAt: new Date(), decisionRequired: null });
      return _id;
    };
    const snapshotOf = (items: { id: ObjectId; start: string; duration: number | null }[]) => items.map((i) => ({ activityId: id(i.id),
      scheduledAt: i.start, durationMinutes: i.duration }));
    const chosen = { scheduledAt: occurrence.toISOString(), durationMinutes: 60 };
    const status = async (activityId: ObjectId, user = actor) =>
      (await db.collection("activityParticipations").findOne({ tripId: trip, activityId, userId: user }))?.status;
    const state = () => Promise.all(["activities", "activityParticipations"].map((name) => db.collection(name).find().toArray()));
    const run = (extra: Record<string, unknown> = {}) => api.createActivity!({ ...input(), durationMinutes: 60, ...extra } as never);

    it("stores the activity and the author's going atomically, without records for other members", async () => {
      const member = other();
      await db.collection("tripMembers").insertOne({ tripId: trip, userId: member, role: "participant", joinedAt: new Date() });
      const result = await run();
      expect(result).toMatchObject({ ok: true, value: { outcome: "created", participation: { userId: id(actor), status: "going" } } });
      if (!result.ok || result.value.outcome !== "created") throw new Error("not created");
      expect(await db.collection("activities").countDocuments({ tripId: trip })).toBe(1);
      expect(await status(new ObjectId(result.value.activity.id))).toBe("going");
      expect(await db.collection("activityParticipations").countDocuments({ userId: member })).toBe(0);
      expect(await db.collection("activityParticipations").countDocuments()).toBe(1);
    });

    it("requires confirmation before inserting and lists every incompatible plan", async () => {
      const a = await seedGoing("2026-09-25T11:30:00Z", 60), b = await seedGoing("2026-09-25T12:30:00Z", 30);
      const before = await state();
      const result = await run();
      expect(result).toMatchObject({ ok: true, value: { outcome: "confirmation_required", conflicts: [{ activityId: id(a) }, { activityId: id(b) }] } });
      expect(await state()).toEqual(before);
    });

    it("applies the confirmed not_going in previous plans and going in the new one", async () => {
      const a = await seedGoing("2026-09-25T11:30:00Z", 60), b = await seedGoing("2026-09-25T12:30:00Z", 30);
      const c = await seedGoing("2026-09-25T16:00:00Z", 30), foreign = other(), theirs = await seedGoing("2026-09-25T11:30:00Z", 60, "going", foreign);
      const result = await run({ confirmedConflicts: snapshotOf([{ id: a, start: "2026-09-25T11:30:00Z", duration: 60 },
        { id: b, start: "2026-09-25T12:30:00Z", duration: 30 }]), confirmedActivity: chosen });
      expect(result).toMatchObject({ ok: true, value: { outcome: "created" } });
      if (!result.ok || result.value.outcome !== "created") throw new Error("not created");
      expect([await status(a), await status(b), await status(c), await status(theirs, foreign)]).toEqual(["not_going", "not_going", "going", "going"]);
      expect(await status(new ObjectId(result.value.activity.id))).toBe("going");
    });

    it("asks again, without writing, when the confirmation is stale", async () => {
      const a = await seedGoing("2026-09-25T11:30:00Z", 60);
      const stale = snapshotOf([{ id: a, start: "2026-09-25T11:30:00Z", duration: 60 }]);
      await db.collection("activities").updateOne({ _id: a }, { $set: { durationMinutes: 90 } });
      const before = await state();
      expect(await run({ confirmedConflicts: stale, confirmedActivity: chosen })).toMatchObject({ ok: true, value: { outcome: "confirmation_required" } });
      expect(await state()).toEqual(before);
      // The conflict disappeared: it is created and the previous plan keeps going.
      await db.collection("activities").updateOne({ _id: a }, { $set: { scheduledAt: at("2026-09-25T16:00:00Z") } });
      expect(await run({ confirmedConflicts: stale, confirmedActivity: chosen })).toMatchObject({ ok: true, value: { outcome: "created" } });
      expect(await status(a)).toBe("going");
    });

    it("rolls back the activity and every participation change when a save fails midway", async () => {
      const a = await seedGoing("2026-09-25T11:30:00Z", 60);
      const before = await state();
      const collection = db.collection("activityParticipations");
      const original = collection.findOneAndUpdate.bind(collection);
      let calls = 0;
      vi.spyOn(collection, "findOneAndUpdate").mockImplementation(((...args: unknown[]) => {
        if (++calls === 2) return Promise.reject(new Error("forced failure"));
        return (original as (...a: unknown[]) => unknown)(...args);
      }) as never);
      const open = db.collection.bind(db);
      vi.spyOn(db, "collection").mockImplementation(((name: string, options?: never) => name === "activityParticipations" ? collection : open(name, options)) as never);
      expect(await run({ confirmedConflicts: snapshotOf([{ id: a, start: "2026-09-25T11:30:00Z", duration: 60 }]), confirmedActivity: chosen }))
        .toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(calls).toBe(2);
      vi.restoreAllMocks();
      expect(await state()).toEqual(before);
    });

    it("serializes with a concurrent going of the author so both overlapping plans are never going", async () => {
      const a = await seedGoing("2026-09-25T11:30:00Z", 60, "pending");
      const [created, responded] = await Promise.all([run(), api.setActivityParticipation!({ ...context(), activityId: id(a), status: "going" })]);
      expect(created.ok && responded.ok).toBe(true);
      const outcomes = [created, responded].map((r) => r.ok ? (r.value as { outcome: string }).outcome : "error");
      expect(outcomes.filter((o) => o === "confirmation_required")).toHaveLength(1);
      expect(await db.collection("activityParticipations").countDocuments({ userId: actor, status: "going" })).toBe(1);
    });

    it("keeps the activity visible when the author stops attending or the participation is deleted", async () => {
      const created = await run();
      if (!created.ok || created.value.outcome !== "created") throw new Error("not created");
      const activityId = created.value.activity.id;
      expect(await api.setActivityParticipation!({ ...context(), activityId, status: "not_going" })).toMatchObject({ ok: true });
      expect(await db.collection("activities").countDocuments({ _id: new ObjectId(activityId) })).toBe(1);
      await db.collection("activityParticipations").deleteMany({ tripId: trip });
      expect(await api.getActivity!({ ...context(), activityId })).toMatchObject({ ok: true, value: { id: activityId } });
      expect(await api.listActivities!(context())).toMatchObject({ ok: true, value: [{ id: activityId }] });
    });

    it("reports a malformed confirmation as a validation error without writing", async () => {
      await seedGoing("2026-09-25T11:30:00Z", 60);
      const before = await state();
      expect(await run({ confirmedConflicts: "x" })).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
      expect(await state()).toEqual(before);
    });
  });

  describe("decisionRequired on schedule edits (T53)", () => {
    const at = (iso: string) => new Date(iso);
    const editedId = new ObjectId(), planA = new ObjectId();
    const addMember = async () => {
      const user = new ObjectId();
      await db.collection("tripMembers").insertOne({ tripId: trip, userId: user, role: "participant", joinedAt: new Date() });
      return user;
    };
    const seedActivity = (_id: ObjectId, start: string, duration: number | null) => db.collection("activities").insertOne({ _id, tripId: trip,
      dayId: day, title: "Plan", description: null, scheduledAt: at(start), durationMinutes: duration, mapsUrl: null, createdBy: actor, createdAt: new Date() });
    const seedPart = (activityId: ObjectId, userId: ObjectId, status = "going") => db.collection("activityParticipations").insertOne({
      _id: new ObjectId(), tripId: trip, activityId, userId, status, updatedAt: at("2026-01-01T00:00:00Z"), decisionRequired: null });
    const record = (activityId: ObjectId, userId: ObjectId) => db.collection("activityParticipations").findOne({ tripId: trip, activityId, userId });
    const edit = (patch: Record<string, unknown>) => api.updateActivity!({ ...context(), activityId: id(editedId), ...patch } as never);
    const state = () => Promise.all(["activities", "activityParticipations"].map((name) => db.collection(name).find().toArray()));
    beforeEach(async () => {
      await seedActivity(editedId, "2026-09-25T10:30:00Z", 60);
      await seedActivity(planA, "2026-09-25T12:00:00Z", 60);
    });

    it("persists pending with a decisionRequired marker for the conflicted going and keeps everything else", async () => {
      const u1 = await addMember(), u2 = await addMember();
      await seedPart(editedId, actor); await seedPart(planA, actor);
      await seedPart(editedId, u1); await seedPart(planA, u1);
      await seedPart(editedId, u2);
      const planBefore = await record(planA, u1);
      const before = Date.now();
      const result = await edit({ scheduledAt: at("2026-09-25T12:30:00Z") });
      expect(result).toMatchObject({ ok: true, value: { activity: { scheduledAt: at("2026-09-25T12:30:00Z") } } });
      if (!result.ok) throw result.error;
      expect(result.value.affected.map((p) => p.userId).sort()).toEqual([id(actor), id(u1)].sort());
      for (const user of [actor, u1]) {
        const stored = await record(editedId, user);
        expect(stored).toMatchObject({ status: "pending", decisionRequired: { reason: "schedule_conflict", changedFields: ["scheduledAt"] } });
        expect(stored!.decisionRequired.changedAt).toBeInstanceOf(Date);
        expect(stored!.decisionRequired.changedAt.getTime()).toBeGreaterThanOrEqual(before);
        expect(stored!.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
      }
      expect((await record(editedId, actor))!.decisionRequired.changedAt).toEqual((await record(editedId, u1))!.decisionRequired.changedAt);
      expect(await record(planA, u1)).toEqual(planBefore);
      expect(await record(editedId, u2)).toMatchObject({ status: "going", decisionRequired: null });
      expect(await db.collection("activityParticipations").countDocuments({ status: "not_going" })).toBe(0);
    });

    it("marks durationMinutes only when only the duration changes", async () => {
      await seedPart(editedId, actor); await seedPart(planA, actor);
      expect(await edit({ durationMinutes: 150 })).toMatchObject({ ok: true });
      expect(await record(editedId, actor)).toMatchObject({ status: "pending", decisionRequired: { changedFields: ["durationMinutes"] } });
    });

    it("does not change participations when only content or location changes or the schedule is identical", async () => {
      await seedPart(editedId, actor); await seedPart(planA, actor);
      const before = (await state())[1];
      expect(await edit({ title: "Otro", description: "d", mapsUrl: "https://maps.app.goo.gl/x" })).toMatchObject({ ok: true });
      expect(await edit({ scheduledAt: at("2026-09-25T10:30:00Z"), durationMinutes: 60 })).toMatchObject({ ok: true });
      expect((await state())[1]).toEqual(before);
    });

    it("keeps a previous marker untouched on a second edit and never touches former members", async () => {
      const u1 = await addMember(), gone = new ObjectId();
      const marker = { reason: "schedule_conflict", changedFields: ["durationMinutes"], changedAt: at("2026-11-01T00:00:00Z") };
      await seedPart(planA, u1);
      await db.collection("activityParticipations").insertOne({ _id: new ObjectId(), tripId: trip, activityId: editedId, userId: u1, status: "pending",
        updatedAt: at("2026-11-01T00:00:00Z"), decisionRequired: marker });
      await seedPart(editedId, gone);
      await seedPart(planA, gone);
      const before = (await state())[1];
      expect(await edit({ scheduledAt: at("2026-09-25T12:30:00Z") })).toMatchObject({ ok: true, value: { affected: [] } });
      expect((await state())[1]).toEqual(before);
    });

    it("removes the marker only with an explicit going/not_going answer", async () => {
      await seedPart(editedId, actor); await seedPart(planA, actor);
      await edit({ scheduledAt: at("2026-09-25T12:30:00Z") });
      expect(await api.setActivityParticipation!({ ...context(), activityId: id(editedId), status: "not_going" })).toMatchObject({ ok: true });
      expect(await record(editedId, actor)).toMatchObject({ status: "not_going", decisionRequired: null });
    });

    it("rolls back the activity and every participation when a later write fails", async () => {
      const u1 = await addMember();
      for (const user of [actor, u1]) { await seedPart(editedId, user); await seedPart(planA, user); }
      const before = await state();
      const collection = db.collection("activityParticipations");
      const original = collection.findOneAndUpdate.bind(collection);
      let calls = 0;
      vi.spyOn(collection, "findOneAndUpdate").mockImplementation(((...args: unknown[]) => {
        if (++calls === 2) return Promise.reject(new Error("forced failure"));
        return (original as (...a: unknown[]) => unknown)(...args);
      }) as never);
      const open = db.collection.bind(db);
      vi.spyOn(db, "collection").mockImplementation(((name: string, options?: never) => name === "activityParticipations" ? collection : open(name, options)) as never);
      const result = await edit({ scheduledAt: at("2026-09-25T12:30:00Z") });
      expect(result).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(result).not.toHaveProperty("value");
      expect(calls).toBe(2);
      vi.restoreAllMocks();
      expect(await state()).toEqual(before);
    });

    it("serializes an edit with a concurrent going of the same user so both overlapping plans are never going", async () => {
      await seedPart(planA, actor); await seedPart(editedId, actor, "pending");
      const [edited, responded] = await Promise.all([edit({ scheduledAt: at("2026-09-25T12:30:00Z") }),
        api.setActivityParticipation!({ ...context(), activityId: id(editedId), status: "going" })]);
      expect(edited.ok && responded.ok).toBe(true);
      expect(await record(planA, actor)).toMatchObject({ status: "going" });
      expect((await record(editedId, actor))!.status).toBe("pending");
    });

    describe("edit and expulsion of a participant", () => {
      const conflicting = { scheduledAt: at("2026-09-25T12:30:00Z") };
      let admin: ObjectId, member: ObjectId, stays: ObjectId;
      const expel = () => api.expelMember!({ tripId: id(trip), actorUserId: id(admin), targetUserId: id(member) });
      const marker = { reason: "schedule_conflict", changedFields: ["scheduledAt"] };
      beforeEach(async () => {
        admin = await addMember(); member = await addMember(); stays = await addMember();
        await db.collection("tripMembers").updateOne({ tripId: trip, userId: admin }, { $set: { role: "admin" } });
        for (const user of [member, stays]) { await seedPart(editedId, user); await seedPart(planA, user); }
      });
      const expectCommon = async () => {
        expect(await db.collection("tripMembers").countDocuments({ tripId: trip, userId: member })).toBe(0);
        expect(await record(editedId, stays)).toMatchObject({ status: "pending", decisionRequired: marker });
        expect(await record(planA, member)).toMatchObject({ status: "going", decisionRequired: null });
      };
      const expectExpelledFirst = async () => {
        await expectCommon();
        // The edit never writes a marker on someone who is no longer a member; the started-activity record is kept as is.
        expect(await record(editedId, member)).toMatchObject({ status: "going", decisionRequired: null });
      };
      const expectEditedFirst = async () => {
        await expectCommon();
        // The edit committed while the user was still a member; the record is kept (activity already started) with its marker.
        expect(await record(editedId, member)).toMatchObject({ status: "pending", decisionRequired: marker });
      };

      it("expulsion first: the edit does not mark the former member", async () => {
        expect(await expel()).toMatchObject({ ok: true });
        expect(await edit(conflicting)).toMatchObject({ ok: true, value: { affected: [{ userId: id(stays) }] } });
        await expectExpelledFirst();
      });

      it("edit first: the member is marked and the expulsion then keeps the started-activity record", async () => {
        expect(await edit(conflicting)).toMatchObject({ ok: true });
        expect(await expel()).toMatchObject({ ok: true });
        await expectEditedFirst();
      });

      it("concurrent edit and expulsion end in exactly one of the two serialized orders", async () => {
        const [edited, expelled] = await Promise.all([edit(conflicting), expel()]);
        expect(edited.ok && expelled.ok).toBe(true);
        if (!edited.ok) throw edited.error;
        const marked = (await record(editedId, member))!.status === "pending";
        // The affected set tells which order happened and must agree with the stored record.
        expect(edited.value.affected.map((p) => p.userId).sort()).toEqual((marked ? [member, stays] : [stays]).map(id).sort());
        if (marked) await expectEditedFirst(); else await expectExpelledFirst();
      });
    });
  });
});
