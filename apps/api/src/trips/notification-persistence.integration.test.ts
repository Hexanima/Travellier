import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { PostFixture, domainId } from "../../test/post-fixture.js";

/** Events and personal notices persisted with the operation that originates them (T91), over a real transactional MongoDB. */
describe("notification persistence with the originating operation", () => {
  const f = new PostFixture();
  beforeAll(() => f.start("notification_persistence"), 120_000);
  afterAll(() => f.stop());
  beforeEach(async () => { vi.restoreAllMocks(); await f.reset(); });
  afterEach(() => vi.restoreAllMocks());

  const addMember = async (role: "admin" | "participant" = "participant") => {
    const userId = new ObjectId();
    await f.db.collection("tripMembers").insertOne({ tripId: f.trip, userId, role, joinedAt: new Date() });
    return userId;
  };
  const events = (filter: Record<string, unknown> = {}) => f.db.collection("outboxEvents").find(filter).sort({ type: 1, userId: 1 }).toArray();
  const failNext = (collectionName: string, method: "bulkWrite" | "findOneAndUpdate" | "insertOne") => {
    const collection = f.db.collection(collectionName), original = f.db.collection.bind(f.db);
    vi.spyOn(collection, method as "insertOne").mockRejectedValueOnce(new Error("forced failure"));
    vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === collectionName ? collection : original(key, options));
  };
  // Deterministic ordering: the first call of `method` on `name` runs for real and then stays paused (its transaction open, Trip lock taken)
  // until `release()`; the rival operation starts while the pause holds.
  let pendingReleases: Array<() => void> = [];
  let launched: Array<Promise<unknown>> = [];
  afterEach(async () => {
    for (const release of pendingReleases) release();
    pendingReleases = [];
    await Promise.allSettled(launched);
    launched = [];
  });
  const pauseAfterFirst = (name: string, method: "insertOne" | "updateOne") => {
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
  const launch = <T>(promise: Promise<T>) => { launched.push(promise); return promise; };
  const track = <T>(promise: Promise<T>) => { const state = { settled: false }; void promise.finally(() => { state.settled = true; }); return state; };
  const concurrent = (name: string, fn: () => Promise<void>) => it(name, fn, 15_000);
  const pause = () => new Promise((resolve) => setTimeout(resolve, 500));
  const expel = (admin: ObjectId, target: ObjectId) => f.api.expelMember!({ tripId: domainId(f.trip), actorUserId: domainId(admin), targetUserId: domainId(target) });
  const state = async () => Promise.all(["posts", "activities", "activityParticipations", "outboxEvents"]
    .map((name) => f.db.collection(name).find().sort({ _id: 1 }).toArray()));
  const spontaneous = { title: "Cena", scheduledAt: f.occurrence, durationMinutes: 60 };

  it("a post emits post.created to every other member, with the stored ids and no text", async () => {
    const [other, admin] = [await addMember(), await addMember("admin")];
    const created = await f.api.createPost!({ ...f.context(), description: "Texto privado" });
    if (!created.ok || created.value.outcome !== "created") throw new Error("Post not created.");
    const stored = await events();
    expect(stored.map((event) => event.userId.toHexString()).sort()).toEqual([other.toHexString(), admin.toHexString()].sort());
    for (const event of stored) {
      expect(event).toMatchObject({ tripId: f.trip, type: "post.created", status: "pending", actorId: f.actor,
        eventKey: `post.created:${created.value.post.id}:${event.userId}`,
        payload: { postId: new ObjectId(created.value.post.id), actorId: f.actor, activityId: null } });
      expect(JSON.stringify(event)).not.toContain("Texto privado");
    }
  });

  it("a post with a spontaneous activity emits post.created and activity.created for the others and never for the author", async () => {
    const other = await addMember();
    const created = await f.api.createPost!({ ...f.context(), description: "Cena", newActivity: spontaneous });
    if (!created.ok || created.value.outcome !== "created") throw new Error("Post not created.");
    const activityId = new ObjectId(created.value.activity!.id);
    const stored = await events();
    expect(stored.map((event) => [event.type, event.userId.toHexString()])).toEqual([["activity.created", other.toHexString()], ["post.created", other.toHexString()]]);
    expect(stored[0]!.payload).toEqual({ activityId, actorId: f.actor, scheduledAt: f.occurrence, durationMinutes: 60 });
    expect(stored[1]!.payload).toEqual({ postId: new ObjectId(created.value.post.id), actorId: f.actor, activityId });
    expect(stored.some((event) => event.userId.equals(f.actor))).toBe(false);
  });

  it("the retry of a saved post (same postId) does not duplicate events", async () => {
    await addMember();
    const postId = domainId(new ObjectId());
    const first = await f.api.createPost!({ ...f.context(), postId, description: "Cena", newActivity: spontaneous });
    expect(first.ok).toBe(true);
    const saved = await events();
    expect(saved).toHaveLength(2);
    expect((await f.api.createPost!({ ...f.context(), postId, description: "Cena", newActivity: spontaneous })).ok).toBe(true);
    expect(await events()).toEqual(saved);
  });

  it("a required plan-change confirmation leaves no event", async () => {
    await addMember();
    expect((await f.api.createPost!({ ...f.context(), newActivity: spontaneous })).ok).toBe(true);
    await f.db.collection("outboxEvents").deleteMany({});
    const before = await state();
    const conflicting = await f.api.createPost!({ ...f.context(), description: "Otra", newActivity: { ...spontaneous, title: "Otra cena" } });
    expect(conflicting).toMatchObject({ ok: true, value: { outcome: "confirmation_required" } });
    expect(await state()).toEqual(before);
  });

  it.each([["outboxEvents", "bulkWrite"], ["activityParticipations", "findOneAndUpdate"], ["activities", "insertOne"]] as const)(
    "saves no post, activity, participation nor event when %s.%s fails", async (collection, method) => {
      await addMember();
      const before = await state();
      failNext(collection, method);
      expect(await f.api.createPost!({ ...f.context(), description: "Cena", newActivity: spontaneous })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(await state()).toEqual(before);
    });

  it("a plain post is not saved when its event cannot be written", async () => {
    await addMember();
    const before = await state();
    failNext("outboxEvents", "bulkWrite");
    expect(await f.api.createPost!({ ...f.context(), description: "Hola" })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
    expect(await state()).toEqual(before);
  });

  it("linking an existing post to a new activity emits only activity.created, and its retry does not duplicate it", async () => {
    const other = await addMember();
    const post = await f.api.createPost!({ ...f.context(), description: "Recuerdo" });
    if (!post.ok || post.value.outcome !== "created") throw new Error("Post not created.");
    await f.db.collection("outboxEvents").deleteMany({});
    const activityId = domainId(new ObjectId());
    const body = { ...f.context(), postId: post.value.post.id, newActivity: { id: activityId, ...spontaneous } };
    expect(await f.api.linkPostToNewActivity!(body)).toMatchObject({ ok: true, value: { outcome: "linked" } });
    const stored = await events();
    expect(stored.map((event) => [event.type, event.userId.toHexString()])).toEqual([["activity.created", other.toHexString()]]);
    expect(await f.api.linkPostToNewActivity!(body)).toMatchObject({ ok: true });
    expect(await events()).toEqual(stored);
  });

  it("editing a post emits no event", async () => {
    await addMember();
    const post = await f.api.createPost!({ ...f.context(), description: "Recuerdo" });
    if (!post.ok || post.value.outcome !== "created") throw new Error("Post not created.");
    const before = await events();
    expect((await f.api.updatePost!({ ...f.context(), postId: post.value.post.id, description: "Editado" })).ok).toBe(true);
    expect(await events()).toEqual(before);
  });

  describe("activities", () => {
    const at = (hhmm: string) => new Date(`2026-09-25T${hhmm}:00Z`);
    const ctx = (user: ObjectId) => ({ tripId: domainId(f.trip), authenticatedUserId: domainId(user) });
    const createActivity = async (user: ObjectId, title: string, start: string, durationMinutes: number | null = 60) => {
      const result = await f.api.createActivity!({ ...ctx(user), dayId: domainId(f.day), title, scheduledAt: at(start), durationMinutes });
      if (!result.ok || result.value.outcome !== "created") throw new Error(JSON.stringify(result));
      return new ObjectId(result.value.activity.id);
    };
    const going = async (user: ObjectId, activityId: ObjectId) => {
      const result = await f.api.setActivityParticipation!({ ...ctx(user), activityId: domainId(activityId), status: "going" });
      if (!result.ok || result.value.outcome !== "saved") throw new Error(JSON.stringify(result));
    };
    const edit = (activityId: ObjectId, patch: Record<string, unknown>, user = f.actor) =>
      f.api.updateActivity!({ ...ctx(user), activityId: domainId(activityId), ...patch });
    const participation = (activityId: ObjectId, userId: ObjectId) => f.db.collection("activityParticipations").findOne({ activityId, userId });
    const marker = { reason: "schedule_conflict", changedFields: ["durationMinutes"], changedAt: new Date("2026-11-01T00:00:00Z") };

    // A: u1 + u2 going (u2 compatible); B: u1 going; u3 pending with a previous marker; the editor is the actor.
    const scenario = async () => {
      const [u1, u2, u3] = [await addMember(), await addMember(), await addMember()];
      const a = await createActivity(u1, "A", "12:00"), b = await createActivity(u1, "B", "14:00");
      await going(u2, a);
      await f.db.collection("activityParticipations").insertOne({ tripId: f.trip, activityId: a, userId: u3, status: "pending", updatedAt: new Date(), decisionRequired: marker });
      await f.db.collection("outboxEvents").deleteMany({});
      return { u1, u2, u3, a, b };
    };
    const activityState = async () => Promise.all(["activities", "activityParticipations", "outboxEvents"].map((name) => f.db.collection(name).find().sort({ _id: 1 }).toArray()));

    it("creating an activity emits activity.created to the other members and not to the author", async () => {
      const other = await addMember();
      const activityId = await createActivity(f.actor, "Cena", "12:00", 90);
      const stored = await events();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ type: "activity.created", userId: other, actorId: f.actor, tripId: f.trip, eventKey: `activity.created:${activityId}:${other}`,
        payload: { activityId, actorId: f.actor, scheduledAt: at("12:00"), durationMinutes: 90 } });
    });

    it("a schedule edit unlinks only who conflicts, with the new interval and every incompatible activity, and keeps the marker semantics", async () => {
      const { u1, u2, u3, a, b } = await scenario();
      const result = await edit(a, { scheduledAt: at("14:30") });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      const unlinked = await events({ type: "activity.participant_unlinked" });
      expect(unlinked).toHaveLength(1);
      const own = await participation(a, u1);
      expect(own).toMatchObject({ status: "pending", decisionRequired: { reason: "schedule_conflict", changedFields: ["scheduledAt"] } });
      expect(unlinked[0]).toMatchObject({ userId: u1, actorId: f.actor, tripId: f.trip, payload: { activityId: a, reason: "schedule_conflict", changedFields: ["scheduledAt"],
        changedAt: own!.decisionRequired.changedAt, newInterval: { startsAt: at("14:30"), durationMinutes: 60, endsAt: at("15:30") },
        incompatibleActivities: [{ activityId: b, reason: "overlap", scheduledAt: at("14:00"), durationMinutes: 60 }] } });
      // The compatible participant keeps going and is only told about the update; so are who was already pending and the non participants.
      expect(await participation(a, u2)).toMatchObject({ status: "going", decisionRequired: null });
      expect(await participation(a, u3)).toMatchObject({ status: "pending", decisionRequired: marker });
      expect((await events({ type: "activity.updated" })).map((event) => event.userId.toHexString()).sort()).toEqual([u2, u3].map((u) => u.toHexString()).sort());
      expect((await events({ type: "activity.updated" }))[0]!.payload).toEqual({ activityId: a, actorId: f.actor, changedFields: ["scheduledAt"] });
      expect((await events()).some((event) => event.userId.equals(f.actor))).toBe(false);
      expect(await f.db.collection("outboxEvents").countDocuments({ tripId: f.trip })).toBe(3);
    });

    it("a content or location edit only emits the update and does not touch participations", async () => {
      const { u1, a } = await scenario();
      const before = await f.db.collection("activityParticipations").find().sort({ _id: 1 }).toArray();
      expect((await edit(a, { title: "Nuevo", mapsUrl: "https://maps.app.goo.gl/x" })).ok).toBe(true);
      expect(await f.db.collection("activityParticipations").find().sort({ _id: 1 }).toArray()).toEqual(before);
      expect(await events({ type: "activity.participant_unlinked" })).toEqual([]);
      const updated = await events({ type: "activity.updated" });
      expect(updated).toHaveLength(3);
      expect(updated.every((event) => JSON.stringify(event.payload.changedFields) === JSON.stringify(["title", "mapsUrl"]))).toBe(true);
      expect(updated.map((event) => event.userId.toHexString())).toContain(u1.toHexString());
      expect(JSON.stringify(updated)).not.toContain("Nuevo");
    });

    it("an edit that changes nothing, and its repetition, add no event", async () => {
      const { a } = await scenario();
      expect((await edit(a, { title: "A", scheduledAt: at("12:00") })).ok).toBe(true);
      expect(await events()).toEqual([]);
      expect((await edit(a, { title: "Otro" })).ok).toBe(true);
      const saved = await events();
      expect((await edit(a, { title: "Otro" })).ok).toBe(true);
      expect(await events()).toEqual(saved);
    });

    it("the editor receives the unlinking when affected", async () => {
      const { a, b } = await scenario();
      await going(f.actor, a); await going(f.actor, b);
      await f.db.collection("outboxEvents").deleteMany({});
      expect((await edit(a, { scheduledAt: at("14:30") })).ok).toBe(true);
      expect((await events({ type: "activity.participant_unlinked", userId: f.actor }))).toHaveLength(1);
      expect(await events({ type: "activity.updated", userId: f.actor })).toEqual([]);
    });

    it("a failure while unlinking leaves no activity change, participation, marker nor event", async () => {
      const { u2, a, b } = await scenario();
      await going(u2, b);
      await f.db.collection("outboxEvents").deleteMany({});
      const before = await activityState();
      const collection = f.db.collection("activityParticipations"), original = f.db.collection.bind(f.db);
      const real = collection.findOneAndUpdate.bind(collection) as (...args: unknown[]) => Promise<unknown>;
      let calls = 0;
      vi.spyOn(collection, "findOneAndUpdate").mockImplementation((async (...args: unknown[]) => { if (++calls === 2) throw new Error("forced failure"); return real(...args); }) as never);
      vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === "activityParticipations" ? collection : original(key, options));
      expect(await edit(a, { scheduledAt: at("14:30") })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(calls).toBe(2);
      expect(await activityState()).toEqual(before);
    });

    it("if the events cannot be written the edit is not saved", async () => {
      const { a } = await scenario();
      const before = await activityState();
      const collection = f.db.collection("outboxEvents"), original = f.db.collection.bind(f.db);
      vi.spyOn(collection, "bulkWrite").mockRejectedValueOnce(new Error("forced failure"));
      vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === "outboxEvents" ? collection : original(key, options));
      expect(await edit(a, { scheduledAt: at("14:30") })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(await activityState()).toEqual(before);
    });

    it("deleting an activity and answering Voy / No voy emit no event", async () => {
      const { u2, a } = await scenario();
      const notGoing = await f.api.setActivityParticipation!({ ...ctx(u2), activityId: domainId(a), status: "not_going" });
      expect(notGoing.ok).toBe(true);
      expect((await f.api.deleteActivity!({ ...ctx(f.actor), activityId: domainId(a) })).ok).toBe(true);
      expect(await events()).toEqual([]);
    });

    concurrent("a participation saved while an edit is in flight waits for it and is not unlinked by it", async () => {
      const { u1, u2, a } = await scenario();
      const late = await addMember();
      const paused = pauseAfterFirst("activities", "updateOne");
      const editing = launch(edit(a, { scheduledAt: at("14:30") }));
      let joining!: ReturnType<typeof going>;
      try {
        await paused.reached;
        joining = launch(going(late, a)); const join = track(joining);
        await pause();
        expect(join.settled, "the participation finished while the edit transaction was open").toBe(false);
      } finally { paused.release(); }
      const settled = await Promise.allSettled([editing, joining]);
      expect(settled.map((s) => s.status)).toEqual(["fulfilled", "fulfilled"]);
      expect(await participation(a, late)).toMatchObject({ status: "going" });
      expect(await participation(a, u2)).toMatchObject({ status: "going" });
      expect((await events({ type: "activity.participant_unlinked" })).map((event) => event.userId)).toEqual([u1]);
      expect(await events({ type: "activity.updated", userId: late })).toHaveLength(1);
    });

    concurrent("an expulsion waits for an in-flight edit, which still notifies the member of the unlinking", async () => {
      const { u1, a } = await scenario();
      const admin = await addMember("admin");
      const paused = pauseAfterFirst("activities", "updateOne");
      const editing = launch(edit(a, { scheduledAt: at("14:30") }));
      let expelling!: ReturnType<typeof expel>;
      try {
        await paused.reached;
        expelling = launch(expel(admin, u1)); const expulsion = track(expelling);
        await pause();
        expect(expulsion.settled, "the expulsion finished while the edit transaction was open").toBe(false);
      } finally { paused.release(); }
      const settled = await Promise.allSettled([editing, expelling]);
      expect(settled.map((s) => s.status)).toEqual(["fulfilled", "fulfilled"]);
      expect(await events({ type: "activity.participant_unlinked", userId: u1 })).toHaveLength(1);
      expect(await f.db.collection("tripMembers").countDocuments({ tripId: f.trip, userId: u1 })).toBe(0);
    });

    concurrent("an edit waits for an in-flight expulsion and then neither unlinks nor notifies the expelled member", async () => {
      const { u1, a } = await scenario();
      const admin = await addMember("admin");
      const paused = pauseAfterFirst("trips", "updateOne");
      const expelling = launch(expel(admin, u1));
      let editing!: ReturnType<typeof edit>;
      try {
        await paused.reached;
        editing = launch(edit(a, { scheduledAt: at("14:30") })); const edition = track(editing);
        await pause();
        expect(edition.settled, "the edit finished while the expulsion transaction was open").toBe(false);
      } finally { paused.release(); }
      const settled = await Promise.allSettled([expelling, editing]);
      expect(settled.map((s) => s.status)).toEqual(["fulfilled", "fulfilled"]);
      expect(await participation(a, u1)).toMatchObject({ status: "going", decisionRequired: null });
      expect(await events({ userId: u1 })).toEqual([]);
    });
  });
});
