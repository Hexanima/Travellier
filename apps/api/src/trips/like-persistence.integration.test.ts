import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMongoTripLikeRepository } from "../adapters/mongodb/trip-like-repository.js";
import { ok } from "app-domain";
import { PostFixture, domainId } from "../../test/post-fixture.js";

describe("like persistence and transactions", () => {
  const f = new PostFixture();
  beforeAll(() => f.start("like_persistence"), 120_000);
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
  const cPayload = (postId: string, commentId: string, user = f.actor, tripId = f.trip) =>
    ({ ...payload(postId, user, tripId), commentId: domainId(new ObjectId(commentId)) });
  const comment = async (postId: string, user = f.actor) => {
    const result = await f.api.createComment!({ ...payload(postId, user), text: "Hola" });
    if (!result.ok) throw result.error;
    return result.value;
  };
  const likePost = (postId: string, user = f.actor) => f.api.likePost!(payload(postId, user));
  const unlikePost = (postId: string, user = f.actor) => f.api.unlikePost!(payload(postId, user));
  const likeComment = (postId: string, commentId: string, user = f.actor) => f.api.likeComment!(cPayload(postId, commentId, user));
  const unlikeComment = (postId: string, commentId: string, user = f.actor) => f.api.unlikeComment!(cPayload(postId, commentId, user));
  const snapshot = () => Promise.all(["trips", "posts", "comments", "tripMembers", "postLikes", "commentLikes"]
    .map((name) => f.db.collection(name).find().sort({ _id: 1 }).toArray()));
  const revision = async () => (await f.db.collection("trips").findOne({ _id: f.trip }))!.destinationOrderRevision ?? 0;
  const expectState = (result: Awaited<ReturnType<typeof likePost>>, liked: boolean, count: number) =>
    expect(result).toEqual({ ok: true, value: { liked, count } });

  it("stores exactly the PRD fields with ObjectId and Date for post and comment likes", async () => {
    const post = await createPost(); const created = await comment(post.id);
    expectState(await likePost(post.id), true, 1);
    expectState(await likeComment(post.id, created.id), true, 1);
    const postLike = await f.db.collection("postLikes").findOne({ tripId: f.trip });
    const commentLike = await f.db.collection("commentLikes").findOne({ tripId: f.trip });
    expect(Object.keys(postLike!).sort()).toEqual(["_id", "createdAt", "postId", "tripId", "userId"]);
    expect(Object.keys(commentLike!).sort()).toEqual(["_id", "commentId", "createdAt", "tripId", "userId"]);
    expect(postLike).toMatchObject({ tripId: f.trip, postId: new ObjectId(post.id), userId: f.actor });
    expect(commentLike).toMatchObject({ tripId: f.trip, commentId: new ObjectId(created.id), userId: f.actor });
    for (const stored of [postLike!, commentLike!]) {
      expect(stored._id).toBeInstanceOf(ObjectId);
      expect(stored.createdAt).toBeInstanceOf(Date);
    }
  });

  it("is idempotent against real Mongo for posts: like, like, unlike, unlike gives 1, 1, 0, 0", async () => {
    const post = await createPost();
    const results = [await likePost(post.id), await likePost(post.id), await unlikePost(post.id), await unlikePost(post.id)];
    expect(results.map((r) => r.ok && [r.value.liked, r.value.count])).toEqual([[true, 1], [true, 1], [false, 0], [false, 0]]);
    expect(await f.db.collection("postLikes").countDocuments({})).toBe(0);
    await likePost(post.id); await likePost(post.id);
    expect(await f.db.collection("postLikes").countDocuments({})).toBe(1);
  });

  it("is idempotent against real Mongo for comments: like, like, unlike, unlike gives 1, 1, 0, 0", async () => {
    const post = await createPost(); const created = await comment(post.id);
    const results = [await likeComment(post.id, created.id), await likeComment(post.id, created.id),
      await unlikeComment(post.id, created.id), await unlikeComment(post.id, created.id)];
    expect(results.map((r) => r.ok && [r.value.liked, r.value.count])).toEqual([[true, 1], [true, 1], [false, 0], [false, 0]]);
    expect(await f.db.collection("commentLikes").countDocuments({})).toBe(0);
  });

  it("has the unique indexes: a manual duplicate fails with 11000", async () => {
    const post = await createPost(); const created = await comment(post.id);
    await likePost(post.id); await likeComment(post.id, created.id);
    await expect(f.db.collection("postLikes").insertOne({ _id: new ObjectId(), tripId: f.trip, postId: new ObjectId(post.id), userId: f.actor, createdAt: new Date() }))
      .rejects.toMatchObject({ code: 11000 });
    await expect(f.db.collection("commentLikes").insertOne({ _id: new ObjectId(), tripId: f.trip, commentId: new ObjectId(created.id), userId: f.actor, createdAt: new Date() }))
      .rejects.toMatchObject({ code: 11000 });
  });

  it("keeps one row and count 1 for two parallel likes of the same user", async () => {
    const post = await createPost(); const created = await comment(post.id);
    const posts = await Promise.all([likePost(post.id), likePost(post.id)]);
    const comments = await Promise.all([likeComment(post.id, created.id), likeComment(post.id, created.id)]);
    for (const result of [...posts, ...comments]) expectState(result, true, 1);
    expect(await f.db.collection("postLikes").countDocuments({})).toBe(1);
    expect(await f.db.collection("commentLikes").countDocuments({})).toBe(1);
  });

  it("leaves a coherent state for simultaneous like and unlike", async () => {
    const post = await createPost(); await likePost(post.id);
    const [a, b] = await Promise.all([likePost(post.id), unlikePost(post.id)]);
    expect(a.ok && b.ok).toBe(true);
    const rows = await f.db.collection("postLikes").countDocuments({});
    expect([0, 1]).toContain(rows);
    const state = await f.api.getPostLikes!(payload(post.id));
    expect(state).toEqual({ ok: true, value: { post: { count: rows, likedByMe: rows === 1 }, comments: [] } });
  });

  it("rolls back and keeps the Trip revision when the like write fails", async () => {
    const post = await createPost(); const created = await comment(post.id); const before = await snapshot();
    const likes = f.db.collection("postLikes"), commentLikes = f.db.collection("commentLikes"), original = f.db.collection.bind(f.db);
    vi.spyOn(likes, "updateOne").mockRejectedValueOnce(new Error("forced failure"));
    vi.spyOn(commentLikes, "updateOne").mockRejectedValueOnce(new Error("forced failure"));
    vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === "postLikes" ? likes : key === "commentLikes" ? commentLikes : original(key, options));
    expect(await likePost(post.id)).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
    expect(await likeComment(post.id, created.id)).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
    expect(await snapshot()).toEqual(before);
  });

  it("rolls back and keeps the Trip revision when the unlike write fails", async () => {
    const post = await createPost(); const created = await comment(post.id);
    await likePost(post.id); await likeComment(post.id, created.id); const before = await snapshot();
    const likes = f.db.collection("postLikes"), commentLikes = f.db.collection("commentLikes"), original = f.db.collection.bind(f.db);
    vi.spyOn(likes, "deleteOne").mockRejectedValueOnce(new Error("forced failure"));
    vi.spyOn(commentLikes, "deleteOne").mockRejectedValueOnce(new Error("forced failure"));
    vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === "postLikes" ? likes : key === "commentLikes" ? commentLikes : original(key, options));
    expect(await unlikePost(post.id)).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
    expect(await unlikeComment(post.id, created.id)).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
    expect(await snapshot()).toEqual(before);
  });

  it("takes the Trip lock once per write, also when idempotent, and never on reads", async () => {
    const post = await createPost(); const created = await comment(post.id);
    const start = await revision();
    await likePost(post.id);
    expect(await revision()).toBe(start + 1);
    await likePost(post.id);
    expect(await revision()).toBe(start + 2);
    await unlikePost(post.id); await unlikePost(post.id);
    expect(await revision()).toBe(start + 4);
    await likeComment(post.id, created.id); await likeComment(post.id, created.id);
    await unlikeComment(post.id, created.id); await unlikeComment(post.id, created.id);
    expect(await revision()).toBe(start + 8);
    expect((await f.api.getPostLikes!(payload(post.id))).ok).toBe(true);
    expect(await revision()).toBe(start + 8);
  });

  it("rolls the lock back when the request is rejected, leaving the Trip revision unchanged", async () => {
    const post = await createPost(); const stranger = new ObjectId(); const before = await snapshot();
    expect(await likePost(post.id, stranger)).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(await f.api.likePost!(payload(new ObjectId().toHexString()))).toMatchObject({ ok: false, error: { tag: "PostNotFoundError" } });
    expect(await snapshot()).toEqual(before);
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

  const targets = [
    { label: "post", collection: "postLikes", run: (post: string) => likePost(post) },
    { label: "comment", collection: "commentLikes", run: (post: string, created: string) => likeComment(post, created) },
  ];

  for (const target of targets) {
    concurrent(`makes an expulsion wait for an in-flight ${target.label} like, which keeps the former member's userId and counts`, async () => {
      const post = await createPost(); const created = await comment(post.id); const admin = await addMember("admin"); await f.releaseOwnership();
      const paused = pauseAfterFirst(target.collection, "updateOne");
      const liking = launch(target.run(post.id, created.id));
      let expelling!: ReturnType<typeof expel>;
      try {
        await paused.reached;
        expelling = launch(expel(admin)); const expulsion = track(expelling);
        await pause();
        expect(expulsion.settled, "expulsion finished while the like transaction was open").toBe(false);
      } finally { paused.release(); }
      const [liked, expelled] = await Promise.all([liking, expelling]);
      expectState(liked, true, 1);
      expect(expelled.ok).toBe(true);
      expect(await f.db.collection(target.collection).find({ tripId: f.trip }).toArray()).toMatchObject([{ userId: f.actor }]);
      const read = await f.api.getPostLikes!(payload(post.id, admin));
      expect(read).toMatchObject({ ok: true, value: { post: { count: target.label === "post" ? 1 : 0, likedByMe: false },
        comments: [{ commentId: created.id, count: target.label === "comment" ? 1 : 0, likedByMe: false }] } });
    });

    concurrent(`makes a ${target.label} like wait for an in-flight expulsion and then fail without writing`, async () => {
      const post = await createPost(); const created = await comment(post.id); const admin = await addMember("admin"); await f.releaseOwnership();
      const paused = pauseAfterFirst("trips", "updateOne");
      const expelling = launch(expel(admin));
      let liking!: ReturnType<typeof likePost>;
      try {
        await paused.reached;
        liking = launch(target.run(post.id, created.id)); const like = track(liking);
        await pause();
        expect(like.settled, "like finished while the expulsion transaction was open").toBe(false);
      } finally { paused.release(); }
      const [liked, expelled] = await Promise.all([liking, expelling]);
      expect(expelled.ok).toBe(true);
      expect(liked).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
      expect(await f.db.collection(target.collection).countDocuments({})).toBe(0);
    });

    concurrent(`makes Trip deletion wait for an in-flight ${target.label} like and leaves no orphan like`, async () => {
      await f.db.collection("tripMembers").updateOne({ tripId: f.trip }, { $set: { role: "admin" } });
      const post = await createPost(); const created = await comment(post.id);
      const paused = pauseAfterFirst(target.collection, "updateOne");
      const liking = launch(target.run(post.id, created.id));
      let deleting!: ReturnType<typeof deleteTrip>;
      try {
        await paused.reached;
        deleting = launch(deleteTrip()); const deletion = track(deleting);
        await pause();
        expect(deletion.settled, "deletion finished while the like transaction was open").toBe(false);
      } finally { paused.release(); }
      const [liked, deleted] = await Promise.all([liking, deleting]);
      expect(liked.ok).toBe(true);
      expect(deleted.ok).toBe(true);
      expect(await f.db.collection("postLikes").countDocuments({ tripId: f.trip })).toBe(0);
      expect(await f.db.collection("commentLikes").countDocuments({ tripId: f.trip })).toBe(0);
    });

    concurrent(`makes a ${target.label} like wait for an in-flight Trip deletion and then fail without writing`, async () => {
      await f.db.collection("tripMembers").updateOne({ tripId: f.trip }, { $set: { role: "admin" } });
      const post = await createPost(); const created = await comment(post.id);
      const paused = pauseAfterFirst("trips", "updateOne");
      const deleting = launch(deleteTrip());
      let liking!: ReturnType<typeof likePost>;
      try {
        await paused.reached;
        liking = launch(target.run(post.id, created.id)); const like = track(liking);
        await pause();
        expect(like.settled, "like finished while the deletion transaction was open").toBe(false);
      } finally { paused.release(); }
      const [liked, deleted] = await Promise.all([liking, deleting]);
      expect(deleted.ok).toBe(true);
      expect(liked).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
      expect(await f.db.collection("postLikes").countDocuments({})).toBe(0);
      expect(await f.db.collection("commentLikes").countDocuments({})).toBe(0);
    });
  }

  it("keeps and counts a former member's likes but denies them any further access", async () => {
    const post = await createPost(); const created = await comment(post.id); const admin = await addMember("admin");
    await likePost(post.id); await likeComment(post.id, created.id); await likePost(post.id, admin);
    await f.releaseOwnership();
    expect((await expel(admin)).ok).toBe(true);
    expect(await f.db.collection("postLikes").countDocuments({ userId: f.actor })).toBe(1);
    expect(await f.db.collection("commentLikes").countDocuments({ userId: f.actor })).toBe(1);
    expect(await f.api.getPostLikes!(payload(post.id, admin))).toEqual({ ok: true, value: { post: { count: 2, likedByMe: true },
      comments: [{ commentId: created.id, count: 1, likedByMe: false }] } });
    const before = await snapshot();
    const denied = { ok: false, error: { tag: "TripNotFoundError" } };
    expect(await likePost(post.id)).toMatchObject(denied);
    expect(await unlikePost(post.id)).toMatchObject(denied);
    expect(await likeComment(post.id, created.id)).toMatchObject(denied);
    expect(await unlikeComment(post.id, created.id)).toMatchObject(denied);
    expect(await f.api.getPostLikes!(payload(post.id))).toMatchObject(denied);
    expect(await snapshot()).toEqual(before);
  });

  it("allows liking a post whose author already left", async () => {
    const admin = await addMember("admin"); const post = await createPost();
    await f.releaseOwnership();
    expect((await expel(admin)).ok).toBe(true);
    expectState(await likePost(post.id, admin), true, 1);
  });

  it("does not expose or write likes across Trips", async () => {
    const post = await createPost(); const created = await comment(post.id); await likePost(post.id);
    const tripB = new ObjectId(), actorB = new ObjectId();
    await f.db.collection("trips").insertOne({ _id: tripB, inviteCode: tripB.toHexString(), visibility: "public", votingEnabled: false, expenseMode: "register" });
    await f.db.collection("tripMembers").insertOne({ tripId: tripB, userId: actorB, role: "participant", joinedAt: new Date() });
    const postB = await createPost(domainId(tripB), domainId(actorB));
    const commentB = await f.api.createComment!({ ...payload(postB.id, actorB, tripB), text: "De B" });
    if (!commentB.ok) throw commentB.error;
    const before = await snapshot();
    const notTrip = { ok: false, error: { tag: "TripNotFoundError" } };
    expect(await f.api.likePost!(payload(postB.id, f.actor, tripB))).toMatchObject(notTrip);
    expect(await f.api.unlikePost!(payload(postB.id, f.actor, tripB))).toMatchObject(notTrip);
    expect(await f.api.likeComment!(cPayload(postB.id, commentB.value.id, f.actor, tripB))).toMatchObject(notTrip);
    expect(await f.api.unlikeComment!(cPayload(postB.id, commentB.value.id, f.actor, tripB))).toMatchObject(notTrip);
    expect(await f.api.getPostLikes!(payload(postB.id, f.actor, tripB))).toMatchObject(notTrip);
    const postMissing = { ok: false, error: { tag: "PostNotFoundError" } };
    expect(await likePost(postB.id)).toMatchObject(postMissing);
    expect(await unlikePost(postB.id)).toMatchObject(postMissing);
    expect(await likeComment(postB.id, commentB.value.id)).toMatchObject(postMissing);
    expect(await f.api.getPostLikes!(payload(postB.id))).toMatchObject(postMissing);
    const commentMissing = { ok: false, error: { tag: "CommentNotFoundError" } };
    expect(await likeComment(post.id, commentB.value.id)).toMatchObject(commentMissing);
    expect(await unlikeComment(post.id, commentB.value.id)).toMatchObject(commentMissing);
    expect(await likeComment(post.id, new ObjectId().toHexString())).toMatchObject(commentMissing);
    // A user of Trip A cannot reach Trip B through Trip A's own id either.
    expect(await f.api.likePost!(payload(postB.id, actorB, f.trip))).toMatchObject(notTrip);
    expect(await snapshot()).toEqual(before);
    expect(created.tripId).toBe(domainId(f.trip));
  });

  it("does not count or expose a like stored with another tripId, even when the data is inconsistent", async () => {
    const post = await createPost(); const created = await comment(post.id); const foreignTrip = new ObjectId(), other = new ObjectId();
    await f.db.collection("postLikes").insertOne({ _id: new ObjectId(), tripId: foreignTrip, postId: new ObjectId(post.id), userId: other, createdAt: new Date() });
    await f.db.collection("commentLikes").insertOne({ _id: new ObjectId(), tripId: foreignTrip, commentId: new ObjectId(created.id), userId: other, createdAt: new Date() });
    expect(await f.api.getPostLikes!(payload(post.id))).toEqual({ ok: true, value: { post: { count: 0, likedByMe: false },
      comments: [{ commentId: created.id, count: 0, likedByMe: false }] } });
    expectState(await likePost(post.id), true, 1);
    expectState(await likeComment(post.id, created.id), true, 1);
    const port = createMongoTripLikeRepository(f.db);
    const seen = await port.withReadSnapshot(domainId(f.trip), async (scope) =>
      ok({ posts: await scope.countPostLikes(domainId(new ObjectId(post.id))), comments: await scope.countCommentLikes(domainId(new ObjectId(created.id))) }));
    expect(seen).toEqual({ ok: true, value: { posts: { ok: true, value: 1 }, comments: { ok: true, value: 1 } } });
  });

  it("keeps post likes and comment likes independent and reports per-user state", async () => {
    const post = await createPost(); const created = await comment(post.id); const other = await addMember("participant");
    await likePost(post.id); await likePost(post.id, other); await likeComment(post.id, created.id, other);
    await unlikePost(post.id, other);
    expect(await f.api.getPostLikes!(payload(post.id))).toEqual({ ok: true, value: { post: { count: 1, likedByMe: true },
      comments: [{ commentId: created.id, count: 1, likedByMe: false }] } });
    expect(await f.api.getPostLikes!(payload(post.id, other))).toEqual({ ok: true, value: { post: { count: 1, likedByMe: false },
      comments: [{ commentId: created.id, count: 1, likedByMe: true }] } });
  });

  it("GET uses a snapshot without writing", async () => {
    const post = await createPost(); await comment(post.id); const before = await snapshot();
    expect((await f.api.getPostLikes!(payload(post.id))).ok).toBe(true);
    expect(await snapshot()).toEqual(before);
  });

  it("is not affected by editing the post, editing the comment or deleting the linked activity", async () => {
    const post = await createPost(); const created = await comment(post.id);
    const activity = await f.api.createActivity!({ ...f.context(), dayId: domainId(f.day), title: "Cena", scheduledAt: f.occurrence });
    if (!activity.ok || activity.value.outcome !== "created") throw new Error("Activity not created.");
    await f.api.updatePost!({ ...f.context(), postId: post.id, activityId: activity.value.activity.id });
    await likePost(post.id); await likeComment(post.id, created.id);
    const likesBefore = await Promise.all(["postLikes", "commentLikes"].map((name) => f.db.collection(name).find().sort({ _id: 1 }).toArray()));
    expect((await f.api.deleteActivity!({ ...f.context(), activityId: activity.value.activity.id })).ok).toBe(true);
    expect((await f.api.updatePost!({ ...f.context(), postId: post.id, description: "Editado" })).ok).toBe(true);
    expect((await f.api.updateComment!({ ...payload(post.id), commentId: created.id, text: "Editado" })).ok).toBe(true);
    expect(await Promise.all(["postLikes", "commentLikes"].map((name) => f.db.collection(name).find().sort({ _id: 1 }).toArray()))).toEqual(likesBefore);
  });
});
