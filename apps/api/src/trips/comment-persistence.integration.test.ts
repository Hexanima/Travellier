import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { commentsQuery } from "../adapters/mongodb/trip-comment-repository.js";
import { PostFixture, domainId } from "../../test/post-fixture.js";

describe("comment persistence and transactions", () => {
  const f = new PostFixture();
  beforeAll(() => f.start("comment_persistence"), 120_000);
  afterAll(() => f.stop());
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

  it.each([1, 2, 3])("serializes commenting with expulsion without leaving a comment written after revocation (round %i)", async () => {
    await f.reset();
    const post = await createPost(); const admin = await addMember("admin");
    const [created, expelled] = await Promise.all([f.api.createComment!({ ...payload(post.id), text: "Hola" }),
      f.api.expelMember!({ tripId: domainId(f.trip), actorUserId: domainId(admin), targetUserId: domainId(f.actor) })]);
    expect(expelled.ok).toBe(true);
    const stored = await f.db.collection("comments").find({ tripId: f.trip }).toArray();
    if (!created.ok) {
      expect(created.error.tag).toBe("TripNotFoundError");
      expect(stored).toHaveLength(0);
    } else {
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ authorId: f.actor });
      expect(await f.api.listComments!(payload(post.id, admin))).toMatchObject({ ok: true, value: [{ authorIsFormerMember: true }] });
    }
    expect(await f.api.createComment!({ ...payload(post.id), text: "No" })).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(await f.db.collection("comments").countDocuments({ tripId: f.trip })).toBe(created.ok ? 1 : 0);
  });

  it("serializes commenting with Trip deletion leaving no orphan comments", async () => {
    await f.db.collection("tripMembers").updateOne({ tripId: f.trip }, { $set: { role: "admin" } });
    const post = await createPost();
    const [created, deleted] = await Promise.all([f.api.createComment!({ ...payload(post.id), text: "Hola" }), f.api.delete!({ tripId: domainId(f.trip), authenticatedUserId: domainId(f.actor) })]);
    expect(deleted.ok).toBe(true);
    if (!created.ok) expect(created.error.tag).toBe("TripNotFoundError");
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
    const post = await createPost(); const created = await comment(post.id); const admin = await addMember("admin");
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
