import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMongoStorageDeletionJobRepository } from "../adapters/mongodb/storage-deletion-job-repository.js";
import { createMongoPhotoLinkRepository } from "../adapters/mongodb/photo-link-repository.js";
import { processStorageDeletionJobs } from "app-domain";
import { PostFixture, domainId } from "../../test/post-fixture.js";
import { FakeObjectStorage } from "../../test/fake-object-storage.js";
import { FakeCleanupStorage } from "../../test/fake-cleanup-storage.js";

describe("memory deletion persistence and transactions (T126)", () => {
  const f = new PostFixture();
  let fake: FakeObjectStorage;
  beforeAll(() => f.start("post_deletion_persistence"), 120_000);
  afterAll(() => f.stop());
  let pendingReleases: Array<() => void> = [];
  let launched: Array<Promise<unknown>> = [];
  afterEach(async () => {
    for (const release of pendingReleases) release();
    pendingReleases = [];
    await Promise.allSettled(launched);
    launched = [];
  });
  beforeEach(async () => { vi.restoreAllMocks(); fake = new FakeObjectStorage(); f.storage = fake; await f.reset(); });

  const addMember = async (role: "admin" | "participant", tripId = f.trip) => {
    const userId = new ObjectId();
    await f.db.collection("tripMembers").insertOne({ tripId, userId, role, joinedAt: new Date() });
    return userId;
  };
  const keyFor = () => {
    const key = `trips/${f.trip}/photos/${f.actor}/${randomUUID()}.jpg`;
    fake.put(key, "image/jpeg");
    return key;
  };
  const pct = (userId: ObjectId) => ({ userId: userId.toHexString(), unit: "percent", value: 100 });
  const rest = (userId: ObjectId) => ({ userId: userId.toHexString(), unit: "remainder", value: null });
  const create = async (fields: object = {}, user = f.actor) => {
    const result = await f.api.createPost!({ ...f.context(), authenticatedUserId: domainId(user), description: "Recuerdo", ...fields });
    if (!result.ok || result.value.outcome !== "created") throw new Error(`Post not created: ${JSON.stringify(result)}`);
    return result.value.post;
  };
  const remove = (postId: string, user = f.actor, tripId = f.trip) =>
    f.api.deletePost!({ tripId: domainId(tripId), authenticatedUserId: domainId(user), postId: domainId(new ObjectId(postId)) });
  const comment = async (postId: string, user = f.actor) => {
    const result = await f.api.createComment!({ ...f.context(), authenticatedUserId: domainId(user), postId: domainId(new ObjectId(postId)), text: "Hola" });
    if (!result.ok) throw result.error;
    return result.value;
  };
  const likePost = (postId: string, user = f.actor) =>
    f.api.likePost!({ ...f.context(), authenticatedUserId: domainId(user), postId: domainId(new ObjectId(postId)) });
  const likeComment = (postId: string, commentId: string, user = f.actor) =>
    f.api.likeComment!({ ...f.context(), authenticatedUserId: domainId(user), postId: domainId(new ObjectId(postId)), commentId: domainId(new ObjectId(commentId)) });
  const collections = ["trips", "posts", "postPhotos", "postExpenses", "postLikes", "comments", "commentLikes", "storageDeletionJobs", "tripMembers"];
  const snapshot = () => Promise.all(collections.map((name) => f.db.collection(name).find().sort({ _id: 1 }).toArray()));
  const count = (name: string, filter: object = {}) => f.db.collection(name).countDocuments(filter);
  const revision = async () => (await f.db.collection("trips").findOne({ _id: f.trip }))!.destinationOrderRevision ?? 0;
  const parentOf = async (postId: string) => (await f.db.collection("posts").findOne({ _id: new ObjectId(postId) }))?.parentPostId ?? null;
  const fullPost = async (parentPostId?: string, extra: object = {}) => {
    const other = await addMember("participant");
    return create({ ...(parentPostId ? { parentPostId: domainId(new ObjectId(parentPostId)) } : {}), photos: [{ key: keyFor() }],
      expense: { totalAmount: 10, currency: "ARS", payments: [pct(f.actor)], shares: [rest(f.actor), rest(other)] }, ...extra });
  };

  it("removes only the documents of the post and queues exactly its photo keys in one pending job", async () => {
    const keys = [keyFor(), keyFor()], otherKey = keyFor();
    const mine = await create({ photos: keys.map((key) => ({ key })), expense: { totalAmount: 10, currency: "ARS" } });
    const other = await create({ photos: [{ key: otherKey }], expense: { totalAmount: 5, currency: "ARS" } });
    const c1 = await comment(mine.id), c2 = await comment(other.id);
    await likePost(mine.id); await likePost(other.id); await likeComment(mine.id, c1.id); await likeComment(other.id, c2.id);
    const tripB = new ObjectId(), actorB = new ObjectId();
    await f.db.collection("trips").insertOne({ _id: tripB, inviteCode: tripB.toHexString(), visibility: "public", votingEnabled: false, expenseMode: "register" });
    await f.db.collection("tripMembers").insertOne({ tripId: tripB, userId: actorB, role: "participant", joinedAt: new Date() });
    const inB = await f.api.createPost!({ tripId: domainId(tripB), authenticatedUserId: domainId(actorB), description: "B" });
    if (!inB.ok) throw inB.error;
    const revisionBefore = await revision();

    expect(await remove(mine.id)).toEqual({ ok: true, value: undefined });

    expect(await f.db.collection("posts").find({ tripId: f.trip }).toArray()).toMatchObject([{ _id: new ObjectId(other.id) }]);
    expect((await f.db.collection("postPhotos").find().toArray()).map((p) => p.s3Key)).toEqual([otherKey]);
    expect(await f.db.collection("postExpenses").find().toArray()).toMatchObject([{ postId: new ObjectId(other.id) }]);
    expect(await f.db.collection("postLikes").find().toArray()).toMatchObject([{ postId: new ObjectId(other.id) }]);
    expect(await f.db.collection("comments").find().toArray()).toMatchObject([{ _id: new ObjectId(c2.id) }]);
    expect(await f.db.collection("commentLikes").find().toArray()).toMatchObject([{ commentId: new ObjectId(c2.id) }]);
    expect(await count("posts", { tripId: tripB })).toBe(1);
    const jobs = await f.db.collection("storageDeletionJobs").find().toArray();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ tripId: f.trip, status: "pending", attempts: 0, resolvedKeys: [], rejectedKeys: [] });
    expect([...jobs[0]!.objectKeys].sort()).toEqual([...keys].sort());
    expect(jobs[0]!.nextAttemptAt).toEqual(jobs[0]!.createdAt);
    expect(await revision()).toBe(revisionBefore + 1);
  });

  it("does not queue a job when the post has no photos", async () => {
    const post = await create({ expense: { totalAmount: 10, currency: "ARS" } });
    expect((await remove(post.id)).ok).toBe(true);
    expect(await count("storageDeletionJobs")).toBe(0);
    expect(await count("posts")).toBe(0);
  });

  it("the storage worker deletes the queued keys and nothing else", async () => {
    const keys = [keyFor(), keyFor()], kept = keyFor();
    const post = await create({ photos: keys.map((key) => ({ key })) });
    await create({ photos: [{ key: kept }] });
    expect((await remove(post.id)).ok).toBe(true);
    const cleanup = new FakeCleanupStorage();
    for (const key of [...keys, kept]) cleanup.put(key, new Date("2026-01-01T00:00:00Z"));
    const now = new Date(Date.now() + 60_000);
    const result = await processStorageDeletionJobs({ jobs: createMongoStorageDeletionJobRepository(f.db), links: createMongoPhotoLinkRepository(f.db), storage: cleanup,
      now: () => now, createOwner: () => "owner", deadline: new Date(now.getTime() + 45_000), maxJobs: 10 });
    expect(result).toMatchObject({ ok: true, value: { processed: 1, completed: 1, resolvedKeys: 2, rejectedKeys: 0 } });
    expect([...cleanup.deleted].sort()).toEqual([...keys].sort());
    expect(cleanup.keys()).toEqual([kept]);
  });

  it("removes the expense so the balance recomputes, and an incomplete expense stays excluded", async () => {
    await f.db.collection("trips").updateOne({ _id: f.trip }, { $set: { expenseMode: "balance" } });
    const other = await addMember("participant");
    const first = await create({ expense: { totalAmount: 100, currency: "ARS", payments: [pct(f.actor)], shares: [rest(f.actor), rest(other)] } });
    const second = await create({ expense: { totalAmount: 40, currency: "ARS", payments: [pct(other)], shares: [rest(f.actor), rest(other)] } });
    const incomplete = await create({ expense: { totalAmount: 30, currency: "ARS", payments: [pct(f.actor)] } });
    const balance = async () => {
      const result = await f.api.getBalance!(f.context());
      if (!result.ok) throw result.error;
      return result.value;
    };
    const net = (value: Awaited<ReturnType<typeof balance>>, user: ObjectId) =>
      value.currencies.find((c) => c.currency === "ARS")?.balances.find((row) => row.userId === user.toHexString())?.netCents;
    const before = await balance();
    expect([before.includedExpenseCount, net(before, f.actor), net(before, other)]).toEqual([2, 3000, -3000]);
    expect(before.excludedExpenses).toHaveLength(1);
    expect((await remove(second.id)).ok).toBe(true);
    const after = await balance();
    expect([after.includedExpenseCount, net(after, f.actor), net(after, other)]).toEqual([1, 5000, -5000]);
    expect(after.excludedExpenses).toHaveLength(1);
    expect((await remove(incomplete.id)).ok).toBe(true);
    expect((await balance()).excludedExpenses).toEqual([]);
    expect((await remove(first.id)).ok).toBe(true);
    expect(await count("postExpenses")).toBe(0);
    expect((await balance()).includedExpenseCount).toBe(0);
  });

  describe("chains", () => {
    it("a branched node hands every child to its parent keeping their content, photos, expense and comments", async () => {
      const a = await create();
      const b = await fullPost(a.id);
      const c = await fullPost(b.id), d = await fullPost(b.id), e = await fullPost(c.id);
      const sibling = await create({ parentPostId: domainId(new ObjectId(a.id)) });
      const cComment = await comment(c.id);
      await likePost(c.id);
      await comment(b.id);
      const childrenBefore = await f.db.collection("posts").find({ _id: { $in: [c.id, d.id, e.id].map((x) => new ObjectId(x)) } }).sort({ _id: 1 }).toArray();
      expect((await remove(b.id)).ok).toBe(true);
      expect(await count("posts", { _id: new ObjectId(b.id) })).toBe(0);
      expect(await parentOf(c.id)).toEqual(new ObjectId(a.id));
      expect(await parentOf(d.id)).toEqual(new ObjectId(a.id));
      expect(await parentOf(e.id)).toEqual(new ObjectId(c.id));
      expect(await parentOf(sibling.id)).toEqual(new ObjectId(a.id));
      const childrenAfter = await f.db.collection("posts").find({ _id: { $in: [c.id, d.id, e.id].map((x) => new ObjectId(x)) } }).sort({ _id: 1 }).toArray();
      const withoutParent = (doc: Record<string, unknown>) => {
        const copy = { ...doc };
        delete copy.parentPostId;
        return copy;
      };
      expect(childrenAfter.map(withoutParent)).toEqual(childrenBefore.map(withoutParent));
      for (const kept of [c, d, e]) {
        expect(await count("postPhotos", { postId: new ObjectId(kept.id) })).toBe(1);
        expect(await count("postExpenses", { postId: new ObjectId(kept.id) })).toBe(1);
      }
      expect(await count("comments", { postId: new ObjectId(c.id) })).toBe(1);
      expect(await count("commentLikes", { commentId: new ObjectId(cComment.id) })).toBe(0);
      expect(await count("postLikes", { postId: new ObjectId(c.id) })).toBe(1);
      expect(await count("comments", { postId: new ObjectId(b.id) })).toBe(0);
      const chain = await f.api.getPostChain!({ ...f.context(), postId: e.id });
      expect(chain).toMatchObject({ ok: true, value: { parent: { id: c.id } } });
      const children = await f.api.getPostChain!({ ...f.context(), postId: a.id });
      expect(children.ok && children.value.children.map((x) => x.id).sort()).toEqual([c.id, d.id, sibling.id].sort());
    });

    it("projects the root activity of a grandchild after the middle post is removed", async () => {
      const activity = await f.api.createActivity!({ ...f.context(), dayId: domainId(f.day), title: "Cena", scheduledAt: f.occurrence });
      if (!activity.ok || activity.value.outcome !== "created") throw new Error("Activity not created.");
      const root = await create({ activityId: activity.value.activity.id });
      const middle = await create({ parentPostId: domainId(new ObjectId(root.id)) });
      const leaf = await create({ parentPostId: domainId(new ObjectId(middle.id)) });
      expect((await remove(middle.id)).ok).toBe(true);
      expect(await f.api.getPostChain!({ ...f.context(), postId: leaf.id }))
        .toMatchObject({ ok: true, value: { parent: { id: root.id }, rootActivityId: activity.value.activity.id } });
    });

    it("deleting a root leaves its children independent without inheriting its activity", async () => {
      const activity = await f.api.createActivity!({ ...f.context(), dayId: domainId(f.day), title: "Cena", scheduledAt: f.occurrence });
      if (!activity.ok || activity.value.outcome !== "created") throw new Error("Activity not created.");
      const root = await create({ activityId: activity.value.activity.id });
      const child = await fullPost(root.id), grandchild = await create({ parentPostId: domainId(new ObjectId(child.id)) });
      expect((await remove(root.id)).ok).toBe(true);
      expect(await f.db.collection("posts").findOne({ _id: new ObjectId(child.id) })).toMatchObject({ parentPostId: null, activityId: null, transportId: null });
      expect(await f.api.getPostChain!({ ...f.context(), postId: grandchild.id })).toMatchObject({ ok: true, value: { rootActivityId: null, parent: { id: child.id } } });
      expect(await count("postPhotos", { postId: new ObjectId(child.id) })).toBe(1);
      expect(await count("postExpenses", { postId: new ObjectId(child.id) })).toBe(1);
      expect(await count("activities", { tripId: f.trip })).toBe(1);
    });
  });

  describe("rollback", () => {
    const failWith = (name: string, method: "deleteOne" | "insertOne" | "deleteMany") => {
      const collection = f.db.collection(name), original = f.db.collection.bind(f.db);
      vi.spyOn(collection, method).mockRejectedValueOnce(new Error("forced failure"));
      vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === name ? collection : original(key, options));
    };
    it.each([["posts", "deleteOne"], ["storageDeletionJobs", "insertOne"], ["postPhotos", "deleteMany"], ["postExpenses", "deleteMany"],
      ["comments", "deleteMany"]] as const)("a failure in %s.%s leaves no change and keeps the Trip revision", async (name, method) => {
      const a = await create(); const b = await fullPost(a.id); await fullPost(b.id);
      await comment(b.id); await likePost(b.id);
      const before = await snapshot();
      failWith(name, method);
      expect(await remove(b.id)).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(await snapshot()).toEqual(before);
    });
  });

  // Deterministic ordering: the first call of `method` on `name` runs for real and then stays paused (transaction open,
  // Trip lock taken) until `release()`. The rival operation starts while the pause holds.
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
  const pause = () => new Promise((resolve) => setTimeout(resolve, 500));
  const waits = async (rival: Promise<unknown>) => { const state = track(rival); await pause(); expect(state.settled, "the rival finished while the transaction was open").toBe(false); };

  concurrent("a deletion in flight makes an edit of the same post wait and then answer not found without recreating anything", async () => {
    const post = await fullPost();
    const paused = pauseAfterFirst("posts", "deleteOne");
    const deleting = launch(remove(post.id));
    let editing!: ReturnType<NonNullable<typeof f.api.updatePost>>;
    try {
      await paused.reached;
      editing = launch(f.api.updatePost!({ ...f.context(), postId: post.id, description: "Editado" }));
      await waits(editing);
    } finally { paused.release(); }
    const [deleted, edited] = await Promise.all([deleting, editing]);
    expect(deleted.ok).toBe(true);
    expect(edited).toMatchObject({ ok: false, error: { tag: "PostNotFoundError" } });
    expect(await count("posts")).toBe(0);
  });

  concurrent("an edit in flight makes the deletion wait and then remove the edited post", async () => {
    const post = await create();
    const paused = pauseAfterFirst("posts", "updateOne");
    const editing = launch(f.api.updatePost!({ ...f.context(), postId: post.id, description: "Editado" }));
    let deleting!: ReturnType<typeof remove>;
    try {
      await paused.reached;
      deleting = launch(remove(post.id));
      await waits(deleting);
    } finally { paused.release(); }
    const [edited, deleted] = await Promise.all([editing, deleting]);
    expect(edited.ok).toBe(true);
    expect(deleted.ok).toBe(true);
    expect(await count("posts")).toBe(0);
  });

  concurrent("a deletion in flight makes a new comment wait and fail, leaving no orphan comment", async () => {
    const post = await create();
    const paused = pauseAfterFirst("posts", "deleteOne");
    const deleting = launch(remove(post.id));
    let commenting!: Promise<unknown>;
    try {
      await paused.reached;
      commenting = launch(f.api.createComment!({ ...f.context(), postId: domainId(new ObjectId(post.id)), text: "Tarde" }));
      await waits(commenting);
    } finally { paused.release(); }
    const [deleted, commented] = await Promise.all([deleting, commenting]);
    expect(deleted).toMatchObject({ ok: true });
    expect(commented).toMatchObject({ ok: false, error: { tag: "PostNotFoundError" } });
    expect(await count("comments")).toBe(0);
  });

  concurrent("a comment in flight makes the deletion wait and then remove it too", async () => {
    const post = await create();
    const paused = pauseAfterFirst("comments", "insertOne");
    const commenting = launch(f.api.createComment!({ ...f.context(), postId: domainId(new ObjectId(post.id)), text: "Hola" }));
    let deleting!: ReturnType<typeof remove>;
    try {
      await paused.reached;
      deleting = launch(remove(post.id));
      await waits(deleting);
    } finally { paused.release(); }
    const [commented, deleted] = await Promise.all([commenting, deleting]);
    expect(commented.ok).toBe(true);
    expect(deleted.ok).toBe(true);
    expect(await count("comments")).toBe(0);
    expect(await count("posts")).toBe(0);
  });

  concurrent("a continuation being published while its parent is deleted ends reparented, never pointing to a deleted post", async () => {
    const a = await create(); const b = await create({ parentPostId: domainId(new ObjectId(a.id)) });
    const paused = pauseAfterFirst("posts", "insertOne");
    const publishing = launch(f.api.createPost!({ ...f.context(), description: "Continuación", parentPostId: domainId(new ObjectId(b.id)) }));
    let deleting!: ReturnType<typeof remove>;
    try {
      await paused.reached;
      deleting = launch(remove(b.id));
      await waits(deleting);
    } finally { paused.release(); }
    const [published, deleted] = await Promise.all([publishing, deleting]);
    expect(published.ok).toBe(true);
    expect(deleted.ok).toBe(true);
    const child = await f.db.collection("posts").findOne({ description: "Continuación" });
    expect(child?.parentPostId).toEqual(new ObjectId(a.id));
  });

  concurrent("a deletion in flight makes a continuation of that post wait and fail without a dangling child", async () => {
    const a = await create(); const b = await create({ parentPostId: domainId(new ObjectId(a.id)) });
    const paused = pauseAfterFirst("posts", "deleteOne");
    const deleting = launch(remove(b.id));
    let publishing!: Promise<unknown>;
    try {
      await paused.reached;
      publishing = launch(f.api.createPost!({ ...f.context(), description: "Tarde", parentPostId: domainId(new ObjectId(b.id)) }));
      await waits(publishing);
    } finally { paused.release(); }
    const [deleted, published] = await Promise.all([deleting, publishing]) as [{ ok: boolean }, { ok: boolean }];
    expect(deleted.ok).toBe(true);
    expect(published.ok).toBe(false);
    expect(await count("posts", { description: "Tarde" })).toBe(0);
    expect(await count("posts", { parentPostId: new ObjectId(b.id) })).toBe(0);
  });

  concurrent("a like in flight is removed by the deletion, and a like after it fails", async () => {
    const post = await create();
    const paused = pauseAfterFirst("postLikes", "updateOne");
    const liking = launch(likePost(post.id));
    let deleting!: ReturnType<typeof remove>;
    try {
      await paused.reached;
      deleting = launch(remove(post.id));
      await waits(deleting);
    } finally { paused.release(); }
    const [liked, deleted] = await Promise.all([liking, deleting]);
    expect(liked.ok).toBe(true);
    expect(deleted.ok).toBe(true);
    expect(await count("postLikes")).toBe(0);
    expect(await likePost(post.id)).toMatchObject({ ok: false, error: { tag: "PostNotFoundError" } });
    expect(await count("postLikes")).toBe(0);
  });

  concurrent("a deletion in flight makes the deletion of the Trip wait, and the Trip then disappears with nothing left", async () => {
    await f.db.collection("tripMembers").updateOne({ tripId: f.trip }, { $set: { role: "admin" } });
    const post = await fullPost();
    const paused = pauseAfterFirst("posts", "deleteOne");
    const deleting = launch(remove(post.id));
    let deletingTrip!: ReturnType<NonNullable<typeof f.api.delete>>;
    try {
      await paused.reached;
      deletingTrip = launch(f.api.delete!({ tripId: domainId(f.trip), authenticatedUserId: domainId(f.actor) }));
      await waits(deletingTrip);
    } finally { paused.release(); }
    const [deleted, tripDeleted] = await Promise.all([deleting, deletingTrip]);
    expect(deleted.ok).toBe(true);
    expect(tripDeleted.ok).toBe(true);
    for (const name of ["posts", "postPhotos", "postExpenses", "comments"]) expect(await count(name), name).toBe(0);
    expect(await count("storageDeletionJobs")).toBe(1);
  });

  it("two simultaneous deletions of the same post leave one success and one 404, with a single job", async () => {
    const post = await fullPost();
    const results = await Promise.all([remove(post.id), remove(post.id)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ error: { tag: "PostNotFoundError" } });
    expect(await count("storageDeletionJobs")).toBe(1);
  });

  it("does not touch another Trip even when asked with a post id of that Trip", async () => {
    const tripB = new ObjectId(), actorB = new ObjectId();
    await f.db.collection("trips").insertOne({ _id: tripB, inviteCode: tripB.toHexString(), visibility: "public", votingEnabled: false, expenseMode: "register" });
    await f.db.collection("tripMembers").insertOne({ tripId: tripB, userId: actorB, role: "admin", joinedAt: new Date() });
    const inB = await f.api.createPost!({ tripId: domainId(tripB), authenticatedUserId: domainId(actorB), description: "B" });
    if (!inB.ok || inB.value.outcome !== "created") throw new Error("not created");
    const before = await snapshot();
    expect(await remove(inB.value.post.id)).toMatchObject({ ok: false, error: { tag: "PostNotFoundError" } });
    expect(await remove(inB.value.post.id, f.actor, tripB)).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(await snapshot()).toEqual(before);
  });
});
