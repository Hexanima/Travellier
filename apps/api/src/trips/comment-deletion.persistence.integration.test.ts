import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { PostFixture, domainId } from "../../test/post-fixture.js";

describe("comment deletion persistence and transactions (T126)", () => {
  const f = new PostFixture();
  beforeAll(() => f.start("comment_deletion_persistence"), 120_000);
  afterAll(() => f.stop());
  let pendingReleases: Array<() => void> = [];
  let launched: Array<Promise<unknown>> = [];
  afterEach(async () => {
    for (const release of pendingReleases) release();
    pendingReleases = [];
    await Promise.allSettled(launched);
    launched = [];
  });
  beforeEach(async () => { vi.restoreAllMocks(); await f.reset(); });

  const addMember = async (role: "admin" | "participant") => {
    const userId = new ObjectId();
    await f.db.collection("tripMembers").insertOne({ tripId: f.trip, userId, role, joinedAt: new Date() });
    return userId;
  };
  const createPost = async () => {
    const result = await f.api.createPost!({ ...f.context(), description: "Recuerdo" });
    if (!result.ok || result.value.outcome !== "created") throw new Error("Post not created.");
    return result.value.post;
  };
  const target = (postId: string, user = f.actor) =>
    ({ tripId: domainId(f.trip), authenticatedUserId: domainId(user), postId: domainId(new ObjectId(postId)) });
  const comment = async (postId: string, user = f.actor) => {
    const result = await f.api.createComment!({ ...target(postId, user), text: "Hola" });
    if (!result.ok) throw result.error;
    return result.value;
  };
  const remove = (postId: string, commentId: string, user = f.actor) =>
    f.api.deleteComment!({ ...target(postId, user), commentId: domainId(new ObjectId(commentId)) });
  const likeComment = (postId: string, commentId: string, user = f.actor) =>
    f.api.likeComment!({ ...target(postId, user), commentId: domainId(new ObjectId(commentId)) });
  const snapshot = () => Promise.all(["trips", "posts", "comments", "commentLikes", "postLikes", "tripMembers"]
    .map((name) => f.db.collection(name).find().sort({ _id: 1 }).toArray()));
  const count = (name: string, filter: object = {}) => f.db.collection(name).countDocuments(filter);

  it("removes only the comment and its likes, leaving other comments, likes and the post", async () => {
    const post = await createPost(); const other = await addMember("participant");
    const mine = await comment(post.id), kept = await comment(post.id, other);
    await likeComment(post.id, mine.id); await likeComment(post.id, mine.id, other); await likeComment(post.id, kept.id);
    expect(await remove(post.id, mine.id)).toEqual({ ok: true, value: undefined });
    expect(await f.db.collection("comments").find().toArray()).toMatchObject([{ _id: new ObjectId(kept.id) }]);
    expect(await f.db.collection("commentLikes").find().toArray()).toMatchObject([{ commentId: new ObjectId(kept.id) }]);
    expect(await count("posts")).toBe(1);
  });

  it("an admin removes the comment of a former member", async () => {
    const post = await createPost(); const created = await comment(post.id); const admin = await addMember("admin");
    await f.releaseOwnership();
    expect((await f.api.expelMember!({ tripId: domainId(f.trip), actorUserId: domainId(admin), targetUserId: domainId(f.actor) })).ok).toBe(true);
    expect(await remove(post.id, created.id, f.actor)).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(await count("comments")).toBe(1);
    expect((await remove(post.id, created.id, admin)).ok).toBe(true);
    expect(await count("comments")).toBe(0);
  });

  it("answers 403 to a participant who is not the author without changing anything", async () => {
    const post = await createPost(); const created = await comment(post.id); const other = await addMember("participant");
    await likeComment(post.id, created.id);
    const before = await snapshot();
    expect(await remove(post.id, created.id, other)).toMatchObject({ ok: false, error: { tag: "UnauthorizedError" } });
    expect(await snapshot()).toEqual(before);
  });

  it("repeating the deletion answers CommentNotFoundError", async () => {
    const post = await createPost(); const created = await comment(post.id);
    expect((await remove(post.id, created.id)).ok).toBe(true);
    expect(await remove(post.id, created.id)).toMatchObject({ ok: false, error: { tag: "CommentNotFoundError" } });
  });

  it("does not reach comments of another post or Trip", async () => {
    const post = await createPost(); const otherPost = await createPost(); const created = await comment(post.id);
    const tripB = new ObjectId(), actorB = new ObjectId();
    await f.db.collection("trips").insertOne({ _id: tripB, inviteCode: tripB.toHexString(), visibility: "public", votingEnabled: false, expenseMode: "register" });
    await f.db.collection("tripMembers").insertOne({ tripId: tripB, userId: actorB, role: "admin", joinedAt: new Date() });
    const before = await snapshot();
    expect(await remove(otherPost.id, created.id)).toMatchObject({ ok: false, error: { tag: "CommentNotFoundError" } });
    const crossed = await f.api.deleteComment!({ tripId: domainId(tripB), authenticatedUserId: domainId(actorB), postId: domainId(new ObjectId(post.id)), commentId: domainId(new ObjectId(created.id)) });
    expect(crossed).toMatchObject({ ok: false, error: { tag: "PostNotFoundError" } });
    expect(await f.api.deleteComment!({ tripId: domainId(f.trip), authenticatedUserId: domainId(actorB), postId: domainId(new ObjectId(post.id)), commentId: domainId(new ObjectId(created.id)) }))
      .toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(await snapshot()).toEqual(before);
  });

  it("a failure deleting the likes or the comment rolls everything back and keeps the Trip revision", async () => {
    for (const [name, method] of [["commentLikes", "deleteMany"], ["comments", "deleteOne"]] as const) {
      const post = await createPost(); const created = await comment(post.id); await likeComment(post.id, created.id);
      const before = await snapshot();
      const collection = f.db.collection(name), original = f.db.collection.bind(f.db);
      vi.spyOn(collection, method).mockRejectedValueOnce(new Error("forced failure"));
      vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === name ? collection : original(key, options));
      expect(await remove(post.id, created.id)).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(await snapshot()).toEqual(before);
      vi.restoreAllMocks();
    }
  });

  const pauseAfterFirst = (name: string, method: "insertOne" | "updateOne" | "deleteOne") => {
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
  const waits = async (rival: Promise<unknown>) => {
    const state = track(rival); await new Promise((resolve) => setTimeout(resolve, 500));
    expect(state.settled, "the rival finished while the transaction was open").toBe(false);
  };

  concurrent("a deletion in flight makes an edit wait and then answer CommentNotFoundError without recreating the comment", async () => {
    const post = await createPost(); const created = await comment(post.id);
    const paused = pauseAfterFirst("comments", "deleteOne");
    const deleting = launch(remove(post.id, created.id));
    let editing!: Promise<unknown>;
    try {
      await paused.reached;
      editing = launch(f.api.updateComment!({ ...target(post.id), commentId: created.id, text: "Tarde" }));
      await waits(editing);
    } finally { paused.release(); }
    const [deleted, edited] = await Promise.all([deleting, editing]);
    expect(deleted).toMatchObject({ ok: true });
    expect(edited).toMatchObject({ ok: false, error: { tag: "CommentNotFoundError" } });
    expect(await count("comments")).toBe(0);
  });

  concurrent("a like in flight is removed by the deletion, and a like after it fails without leaving an orphan", async () => {
    const post = await createPost(); const created = await comment(post.id);
    const paused = pauseAfterFirst("commentLikes", "updateOne");
    const liking = launch(likeComment(post.id, created.id));
    let deleting!: ReturnType<typeof remove>;
    try {
      await paused.reached;
      deleting = launch(remove(post.id, created.id));
      await waits(deleting);
    } finally { paused.release(); }
    const [liked, deleted] = await Promise.all([liking, deleting]);
    expect(liked.ok).toBe(true);
    expect(deleted.ok).toBe(true);
    expect(await likeComment(post.id, created.id)).toMatchObject({ ok: false, error: { tag: "CommentNotFoundError" } });
    expect(await count("commentLikes")).toBe(0);
  });

  it("a double simultaneous deletion yields one success and one 404, never a 500", async () => {
    const post = await createPost(); const created = await comment(post.id);
    const results = await Promise.all([remove(post.id, created.id), remove(post.id, created.id)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ error: { tag: "CommentNotFoundError" } });
  });
});
