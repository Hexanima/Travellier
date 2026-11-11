import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { commentsQuery, createMongoTripCommentRepository } from "../adapters/mongodb/trip-comment-repository.js";
import { ok } from "app-domain";
import { PostFixture, domainId } from "../../test/post-fixture.js";

describe("comment persistence and transactions", () => {
  const f = new PostFixture();
  beforeAll(() => f.start("comment_persistence"), 120_000);
  afterAll(() => f.stop());
  // Releases of every pause created by a test. afterEach always frees them (idempotent), so a failed assertion never leaves
  // a transaction open that would block the next reset until the server aborts it.
  // It also waits for every operation the test launched (never launched before `reached` is confirmed, except the one
  // that holds the pause), so none can still run during the next test's reset().
  let pendingReleases: Array<() => void> = [];
  let launched: Array<Promise<unknown>> = [];
  afterEach(async () => {
    for (const release of pendingReleases) release();
    pendingReleases = [];
    await Promise.allSettled(launched);
    launched = [];
  });
  beforeEach(async () => { vi.restoreAllMocks(); await f.reset(); });

  const createPost = async (tripId = domainId(f.trip), user = domainId(f.actor)) => {
    const result = await f.api.createPost!({ tripId, authenticatedUserId: user, description: "Recuerdo" });
    if (!result.ok || result.value.outcome !== "created") throw new Error("Post not created.");
    return result.value.post;
  };
  const addMember = async (role: "admin" | "participant", tripId = f.trip) => {
    const userId = new ObjectId();
    await f.db.collection("tripMembers").insertOne({ tripId, userId, role, joinedAt: new Date() });
    return userId;
  };
  const payload = (postId: string, user = f.actor, tripId = f.trip) =>
    ({ tripId: domainId(tripId), authenticatedUserId: domainId(user), postId: domainId(new ObjectId(postId)) });
  const comment = async (postId: string, text = "Hola", user = f.actor) => {
    expect(f.api.createComment).toBeTypeOf("function");
    const result = await f.api.createComment!({ ...payload(postId, user), text });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw result.error;
    return result.value;
  };
  const snapshot = () => Promise.all(["trips", "posts", "comments", "tripMembers"]
    .map((name) => f.db.collection(name).find().sort({ _id: 1 }).toArray()));

  it("stores exactly the PRD fields with ObjectId and Date and keeps authorship when another member edits", async () => {
    const post = await createPost();
    const created = await comment(post.id, "  Qué lindo  ");
    const stored = await f.db.collection("comments").findOne({ _id: new ObjectId(created.id) });
    expect(Object.keys(stored!).sort()).toEqual(["_id", "authorId", "createdAt", "postId", "text", "tripId"]);
    expect(stored).toMatchObject({ tripId: f.trip, postId: new ObjectId(post.id), authorId: f.actor, text: "Qué lindo" });
    expect(stored!.createdAt).toBeInstanceOf(Date);
    const editor = await addMember("admin");
    const edited = await f.api.updateComment!({ ...payload(post.id, editor), commentId: created.id, text: "Editado" });
    expect(edited).toEqual({ ok: true, value: { ...created, text: "Editado", authorIsFormerMember: false } });
    const after = await f.db.collection("comments").findOne({ _id: new ObjectId(created.id) });
    expect(after).toEqual({ ...stored, text: "Editado" });
  });

  it("rolls back and keeps the Trip revision when insertOne fails", async () => {
    const post = await createPost(); const before = await snapshot();
    const collection = f.db.collection("comments"), original = f.db.collection.bind(f.db);
    vi.spyOn(collection, "insertOne").mockRejectedValueOnce(new Error("forced failure"));
    vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === "comments" ? collection : original(key, options));
    expect(await f.api.createComment!({ ...payload(post.id), text: "Hola" })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
    expect(await snapshot()).toEqual(before);
  });

  it("rolls back and keeps the Trip revision when updateOne fails", async () => {
    const post = await createPost(); const created = await comment(post.id); const before = await snapshot();
    const collection = f.db.collection("comments"), original = f.db.collection.bind(f.db);
    vi.spyOn(collection, "updateOne").mockRejectedValueOnce(new Error("forced failure"));
    vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === "comments" ? collection : original(key, options));
    expect(await f.api.updateComment!({ ...payload(post.id), commentId: created.id, text: "Nuevo" }))
      .toMatchObject({ ok: false, error: { tag: "UnknownError" } });
    expect(await snapshot()).toEqual(before);
  });

  describe("notifications (T91)", () => {
    const events = (type = "comment.created") => f.db.collection("outboxEvents").find({ type }).sort({ userId: 1 }).toArray();
    const snapshotWithEvents = async () => [...(await snapshot()), await f.db.collection("outboxEvents").find().sort({ _id: 1 }).toArray()];

    it("stores one comment.created per other member with exact ids and no text, never for the author", async () => {
      const post = await createPost(); const other = await addMember("participant"); const admin = await addMember("admin");
      const created = await comment(post.id, "Texto privado");
      const stored = await events();
      expect(stored.map((event) => event.userId.toHexString()).sort()).toEqual([other.toHexString(), admin.toHexString()].sort());
      for (const event of stored) {
        expect(event).toMatchObject({ tripId: f.trip, type: "comment.created", status: "pending", actorId: f.actor,
          eventKey: `comment.created:${created.id}:${event.userId}`, operationKey: `comment.created:${created.id}`,
          payload: { commentId: new ObjectId(created.id), postId: new ObjectId(post.id), actorId: f.actor }, createdAt: new Date(created.createdAt) });
        expect(JSON.stringify(event)).not.toContain("Texto privado");
      }
    });

    it("does not emit when a comment is edited or rejected", async () => {
      const post = await createPost(); await addMember("participant");
      const created = await comment(post.id);
      const before = await events();
      expect((await f.api.updateComment!({ ...payload(post.id), commentId: created.id, text: "Nuevo" })).ok).toBe(true);
      expect((await f.api.createComment!({ ...payload(post.id), text: "  " })).ok).toBe(false);
      expect(await events()).toEqual(before);
    });

    it("saves nothing when the events cannot be written", async () => {
      const post = await createPost(); await addMember("participant"); const before = await snapshotWithEvents();
      const collection = f.db.collection("outboxEvents"), original = f.db.collection.bind(f.db);
      vi.spyOn(collection, "bulkWrite").mockRejectedValueOnce(new Error("forced failure"));
      vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === "outboxEvents" ? collection : original(key, options));
      expect(await f.api.createComment!({ ...payload(post.id), text: "Hola" })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(await snapshotWithEvents()).toEqual(before);
    });

    it("leaves no event when the transaction fails after writing them", async () => {
      const post = await createPost(); await addMember("participant"); const before = await snapshotWithEvents();
      const collection = f.db.collection("outboxEvents"), original = f.db.collection.bind(f.db);
      const real = collection.bulkWrite.bind(collection) as (...args: unknown[]) => Promise<unknown>;
      vi.spyOn(collection, "bulkWrite").mockImplementationOnce((async (...args: unknown[]) => { await real(...args); throw new Error("after write"); }) as never);
      vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === "outboxEvents" ? collection : original(key, options));
      expect(await f.api.createComment!({ ...payload(post.id), text: "Hola" })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(await snapshotWithEvents()).toEqual(before);
    });
  });

  it("GET uses a snapshot without changing the Trip revision or content", async () => {
    const post = await createPost(); await comment(post.id); const before = await snapshot();
    const listed = await f.api.listComments!(payload(post.id));
    expect(listed).toMatchObject({ ok: true, value: [{ text: "Hola", authorIsFormerMember: false }] });
    expect(await snapshot()).toEqual(before);
  });

  it("lists oldest first with id as tie-breaker", async () => {
    const post = await createPost(); const same = new Date("2026-10-02T00:00:00Z");
    const [a, b, c] = [new ObjectId(), new ObjectId(), new ObjectId()].sort((x, y) => x.toHexString().localeCompare(y.toHexString()));
    await f.db.collection("comments").insertMany([
      { _id: c!, tripId: f.trip, postId: new ObjectId(post.id), authorId: f.actor, text: "c", createdAt: same },
      { _id: b!, tripId: f.trip, postId: new ObjectId(post.id), authorId: f.actor, text: "b", createdAt: same },
      { _id: a!, tripId: f.trip, postId: new ObjectId(post.id), authorId: f.actor, text: "a", createdAt: new Date("2026-10-03T00:00:00Z") }]);
    const listed = await f.api.listComments!(payload(post.id));
    expect(listed.ok && listed.value.map((x) => x.text)).toEqual(["b", "c", "a"]);
  });

  it("runs the exact listComments query through the postId_createdAt index", async () => {
    const post = await createPost(); await comment(post.id);
    const { filter, sort } = commentsQuery(f.trip, new ObjectId(post.id));
    const plan = await f.db.collection("comments").find(filter).sort(sort).explain("queryPlanner");
    const winning = JSON.stringify(plan.queryPlanner.winningPlan);
    expect(winning).toContain('"indexName":"postId_createdAt"');
    expect(winning).not.toContain("COLLSCAN");
  });

  // Deterministic ordering: the first call of `method` on `name` runs for real and then stays paused (its transaction
  // open, Trip lock already taken) until `release()`. The rival operation is started while the pause holds.
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
  // Real timeout (15 s) above Vitest's 5 s default and above the 3 s `reached` limit, so the clear message wins.
  const concurrent = (name: string, fn: () => Promise<void>) => it(name, fn, 15_000);
  const pause = () => new Promise((resolve) => setTimeout(resolve, 500));
  const expel = (admin: ObjectId) => f.api.expelMember!({ tripId: domainId(f.trip), actorUserId: domainId(admin), targetUserId: domainId(f.actor) });
  const deleteTrip = () => f.api.delete!({ tripId: domainId(f.trip), authenticatedUserId: domainId(f.actor) });

  concurrent("makes an expulsion wait for an in-flight comment, which is kept as former-member", async () => {
    const post = await createPost(); const admin = await addMember("admin"); await f.releaseOwnership();
    const paused = pauseAfterFirst("comments", "insertOne");
    const creating = launch(f.api.createComment!({ ...payload(post.id), text: "Hola" }));
    let expelling!: ReturnType<typeof expel>;
    try {
      await paused.reached;
      expelling = launch(expel(admin)); const expulsion = track(expelling);
      await pause();
      expect(expulsion.settled, "expulsion finished while the comment transaction was open").toBe(false);
    } finally { paused.release(); }
    const [created, expelled] = await Promise.all([creating, expelling]);
    expect(created.ok).toBe(true);
    expect(expelled.ok).toBe(true);
    expect(await f.db.collection("comments").find({ tripId: f.trip }).toArray()).toMatchObject([{ authorId: f.actor, text: "Hola" }]);
    expect(await f.api.listComments!(payload(post.id, admin))).toMatchObject({ ok: true, value: [{ authorIsFormerMember: true }] });
    // The comment saw the author still inside the Trip: its event reached the admin (the author is never notified of their own comment).
    expect((await f.db.collection("outboxEvents").find({ type: "comment.created" }).toArray()).map((event) => event.userId)).toEqual([admin]);
  });

  concurrent("makes a comment wait for an in-flight expulsion and then fail without writing", async () => {
    const post = await createPost(); const admin = await addMember("admin"); await f.releaseOwnership();
    const paused = pauseAfterFirst("trips", "updateOne");
    const expelling = launch(expel(admin));
    let creating!: ReturnType<NonNullable<typeof f.api.createComment>>;
    try {
      await paused.reached;
      creating = launch(f.api.createComment!({ ...payload(post.id), text: "Hola" })); const creation = track(creating);
      await pause();
      expect(creation.settled, "comment finished while the expulsion transaction was open").toBe(false);
    } finally { paused.release(); }
    const [created, expelled] = await Promise.all([creating, expelling]);
    expect(expelled.ok).toBe(true);
    expect(created).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(await f.db.collection("comments").countDocuments({ tripId: f.trip })).toBe(0);
    // The waiting comment failed after the expulsion: no event was written for it.
    expect(await f.db.collection("outboxEvents").countDocuments({ type: "comment.created" })).toBe(0);
  });

  concurrent("makes Trip deletion wait for an in-flight comment and leaves no orphan comment", async () => {
    await f.db.collection("tripMembers").updateOne({ tripId: f.trip }, { $set: { role: "admin" } });
    const post = await createPost();
    const paused = pauseAfterFirst("comments", "insertOne");
    const creating = launch(f.api.createComment!({ ...payload(post.id), text: "Hola" }));
    let deleting!: ReturnType<typeof deleteTrip>;
    try {
      await paused.reached;
      deleting = launch(deleteTrip()); const deletion = track(deleting);
      await pause();
      expect(deletion.settled, "deletion finished while the comment transaction was open").toBe(false);
    } finally { paused.release(); }
    const [created, deleted] = await Promise.all([creating, deleting]);
    expect(created.ok).toBe(true);
    expect(deleted.ok).toBe(true);
    expect(await f.db.collection("comments").countDocuments({ tripId: f.trip })).toBe(0);
  });

  concurrent("makes a comment wait for an in-flight Trip deletion and then fail without writing", async () => {
    await f.db.collection("tripMembers").updateOne({ tripId: f.trip }, { $set: { role: "admin" } });
    const post = await createPost();
    const paused = pauseAfterFirst("trips", "updateOne");
    const deleting = launch(deleteTrip());
    let creating!: ReturnType<NonNullable<typeof f.api.createComment>>;
    try {
      await paused.reached;
      creating = launch(f.api.createComment!({ ...payload(post.id), text: "Hola" })); const creation = track(creating);
      await pause();
      expect(creation.settled, "comment finished while the deletion transaction was open").toBe(false);
    } finally { paused.release(); }
    const [created, deleted] = await Promise.all([creating, deleting]);
    expect(deleted.ok).toBe(true);
    expect(created).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(await f.db.collection("comments").countDocuments({ tripId: f.trip })).toBe(0);
  });

  it("applies two simultaneous edits without corrupting author, date or text", async () => {
    const post = await createPost(); const created = await comment(post.id); const other = await addMember("participant");
    const [first, second] = await Promise.all([f.api.updateComment!({ ...payload(post.id), commentId: created.id, text: "Uno" }),
      f.api.updateComment!({ ...payload(post.id, other), commentId: created.id, text: "Dos" })]);
    expect([first.ok, second.ok]).toEqual([true, true]);
    const stored = await f.db.collection("comments").findOne({ _id: new ObjectId(created.id) });
    expect(["Uno", "Dos"]).toContain(stored!.text);
    expect(stored).toMatchObject({ authorId: f.actor, createdAt: new Date(created.createdAt) });
    expect(Object.keys(stored!).sort()).toEqual(["_id", "authorId", "createdAt", "postId", "text", "tripId"]);
  });

  it("keeps an expelled member's comment as former-member and denies further access", async () => {
    const post = await createPost(); const created = await comment(post.id); const admin = await addMember("admin"); await f.releaseOwnership();
    expect((await f.api.expelMember!({ tripId: domainId(f.trip), actorUserId: domainId(admin), targetUserId: domainId(f.actor) })).ok).toBe(true);
    expect(await f.api.listComments!(payload(post.id, admin))).toMatchObject({ ok: true, value: [{ id: created.id, authorId: created.authorId, authorIsFormerMember: true }] });
    const before = await snapshot();
    expect(await f.api.listComments!(payload(post.id))).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(await f.api.createComment!({ ...payload(post.id), text: "x" })).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(await f.api.updateComment!({ ...payload(post.id), commentId: created.id, text: "x" })).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(await snapshot()).toEqual(before);
  });

  it("does not expose or write comments across Trips", async () => {
    const post = await createPost(); const created = await comment(post.id);
    const tripB = new ObjectId(), actorB = new ObjectId();
    await f.db.collection("trips").insertOne({ _id: tripB, inviteCode: tripB.toHexString(), visibility: "public", votingEnabled: false, expenseMode: "register" });
    await f.db.collection("tripMembers").insertOne({ tripId: tripB, userId: actorB, role: "participant", joinedAt: new Date() });
    const postB = await createPost(domainId(tripB), domainId(actorB));
    const inB = await f.api.createComment!({ ...payload(postB.id, actorB, tripB), text: "De B" });
    if (!inB.ok) throw inB.error;
    const before = await snapshot();
    expect(await f.api.listComments!(payload(postB.id, f.actor, tripB))).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(await f.api.createComment!({ ...payload(postB.id, f.actor, tripB), text: "x" })).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(await f.api.updateComment!({ ...payload(postB.id, f.actor, tripB), commentId: inB.value.id, text: "x" })).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(await f.api.listComments!(payload(postB.id))).toMatchObject({ ok: false, error: { tag: "PostNotFoundError" } });
    expect(await f.api.createComment!({ ...payload(postB.id), text: "x" })).toMatchObject({ ok: false, error: { tag: "PostNotFoundError" } });
    expect(await f.api.updateComment!({ ...payload(postB.id), commentId: inB.value.id, text: "x" })).toMatchObject({ ok: false, error: { tag: "PostNotFoundError" } });
    expect(await f.api.updateComment!({ ...payload(post.id), commentId: inB.value.id, text: "x" })).toMatchObject({ ok: false, error: { tag: "CommentNotFoundError" } });
    expect(await snapshot()).toEqual(before);
    expect(created.tripId).toBe(domainId(f.trip));
  });

  it("takes the Trip lock once per create and per edit, and never on reads", async () => {
    const post = await createPost();
    const revision = async () => (await f.db.collection("trips").findOne({ _id: f.trip }))!.destinationOrderRevision ?? 0;
    const start = await revision();
    const created = await comment(post.id);
    expect(await revision()).toBe(start + 1);
    expect((await f.api.updateComment!({ ...payload(post.id), commentId: created.id, text: "Nuevo" })).ok).toBe(true);
    expect(await revision()).toBe(start + 2);
    await f.api.listComments!(payload(post.id));
    expect(await revision()).toBe(start + 2);
  });

  it("scopes the repository queries to the Trip even when stored data is inconsistent", async () => {
    const post = await createPost(); const foreignTrip = new ObjectId(); const foreign = new ObjectId();
    await f.db.collection("comments").insertOne({ _id: foreign, tripId: foreignTrip, postId: new ObjectId(post.id), authorId: f.actor, text: "ajeno", createdAt: new Date() });
    const port = createMongoTripCommentRepository(f.db);
    const seen = await port.withReadSnapshot(domainId(f.trip), async (scope) => {
      const listed = await scope.listComments(domainId(new ObjectId(post.id)));
      const found = await scope.findComment(domainId(foreign), domainId(new ObjectId(post.id)));
      return ok({ listed, found });
    });
    expect(seen).toMatchObject({ ok: true, value: { listed: { ok: true, value: [] }, found: { ok: true, value: undefined } } });
  });

  it("is not affected by editing the post or deleting its activity, and never becomes a child post", async () => {
    const post = await createPost();
    const activity = await f.api.createActivity!({ ...f.context(), dayId: domainId(f.day), title: "Cena", scheduledAt: f.occurrence });
    if (!activity.ok || activity.value.outcome !== "created") throw new Error("Activity not created.");
    await f.api.updatePost!({ ...f.context(), postId: post.id, activityId: activity.value.activity.id });
    await comment(post.id);
    const postsBefore = await f.db.collection("posts").find().sort({ _id: 1 }).toArray();
    const commentsBefore = await f.db.collection("comments").find().sort({ _id: 1 }).toArray();
    expect((await f.api.deleteActivity!({ ...f.context(), activityId: activity.value.activity.id })).ok).toBe(true);
    expect((await f.api.updatePost!({ ...f.context(), postId: post.id, description: "Editado" })).ok).toBe(true);
    expect(await f.db.collection("comments").find().sort({ _id: 1 }).toArray()).toEqual(commentsBefore);
    expect(await f.db.collection("posts").countDocuments({ tripId: f.trip })).toBe(postsBefore.length);
    const chain = await f.api.getPostChain!({ ...f.context(), postId: post.id });
    expect(chain).toMatchObject({ ok: true, value: { children: [] } });
  });
});
