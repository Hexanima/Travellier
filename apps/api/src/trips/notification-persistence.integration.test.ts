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
});
