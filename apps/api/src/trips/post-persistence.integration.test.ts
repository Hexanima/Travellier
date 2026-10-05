import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { PostFixture, domainId } from "../../test/post-fixture.js";

describe("post persistence and transactions", () => {
  const f = new PostFixture();
  beforeAll(() => f.start("post_persistence"), 120_000);
  afterAll(() => f.stop());
  beforeEach(async () => { vi.restoreAllMocks(); await f.reset(); });
  const create = async (fields = {}) => {
    expect(f.api.createPost).toBeTypeOf("function");
    const result = await f.api.createPost!({ ...f.input(), ...fields });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw result.error;
    return result.value;
  };

  it("persists BSON references and dates and preserves authorship during another member's edit", async () => {
    const { post } = await create();
    const stored = await f.db.collection("posts").findOne({ _id: new ObjectId(post.id) });
    expect(stored).toMatchObject({ tripId: f.trip, dayId: f.day, authorId: f.actor, activityId: null, parentPostId: null, transportId: null });
    expect(stored!.createdAt).toBeInstanceOf(Date);
    const editor = new ObjectId(); await f.db.collection("tripMembers").insertOne({ tripId: f.trip, userId: editor, role: "admin" });
    expect(await f.api.updatePost!({ ...f.context(), authenticatedUserId: domainId(editor), postId: post.id, description: "Editado" }))
      .toEqual({ ok: true, value: { ...post, description: "Editado" } });
    expect(await f.api.getPost!({ ...f.context(), postId: post.id })).toMatchObject({ ok: true, value: { authorId: post.authorId, createdAt: post.createdAt } });
  });

  it.each([false, true])("stores joint creation with voting=%s and UTC milliseconds", async (votingEnabled) => {
    await f.db.collection("trips").updateOne({ _id: f.trip }, { $set: { votingEnabled } });
    const { post, activity } = await create({ newActivity: { title: "Cena", scheduledAt: f.occurrence } });
    expect(activity).toMatchObject({ status: votingEnabled ? "proposed" : "confirmed", scheduledAt: f.occurrence, createdBy: post.authorId });
    const stored = await f.db.collection("posts").findOne({ _id: new ObjectId(post.id) });
    expect(stored!.activityId).toEqual(new ObjectId(activity!.id));
    expect(await f.db.collection("activities").findOne({ _id: stored!.activityId })).toMatchObject({ scheduledAt: f.occurrence, dayId: f.day, tripId: f.trip });
  });

  it.each(["posts", "activities"])("rolls back joint creation and Trip revision when %s insertion fails", async (name) => {
    expect(f.api.createPost).toBeTypeOf("function"); const before = await f.snapshot();
    const collection = f.db.collection(name), original = f.db.collection.bind(f.db);
    vi.spyOn(collection, "insertOne").mockRejectedValueOnce(new Error("forced failure"));
    vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === name ? collection : original(key, options));
    expect(await f.api.createPost!({ ...f.input(), newActivity: { title: "Cena", scheduledAt: f.occurrence } }))
      .toMatchObject({ ok: false, error: { tag: "UnknownError" } });
    expect(await f.snapshot()).toEqual(before);
  });

  it("rolls back invalid relinks and write failures without modifying unrelated collections", async () => {
    const { post } = await create();
    for (const name of ["postPhotos", "postExpenses", "postLikes", "comments", "commentLikes"])
      await f.db.collection(name).insertOne({ tripId: f.trip, postId: new ObjectId(post.id), value: "preserved" });
    const before = await f.snapshot();
    expect(await f.api.updatePost!({ ...f.context(), postId: post.id, description: "No", parentPostId: domainId(new ObjectId()) }))
      .toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(await f.snapshot()).toEqual(before);
    const collection = f.db.collection("posts"), original = f.db.collection.bind(f.db);
    vi.spyOn(collection, "updateOne").mockRejectedValueOnce(new Error("forced failure"));
    vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === "posts" ? collection : original(key, options));
    expect(await f.api.updatePost!({ ...f.context(), postId: post.id, description: "No" })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
    expect(await f.snapshot()).toEqual(before);
    for (const name of ["postPhotos", "postExpenses", "postLikes", "comments", "commentLikes"])
      expect(await f.db.collection(name).findOne({ postId: new ObjectId(post.id) })).toMatchObject({ value: "preserved" });
  });

  it("GET uses a snapshot without changing Trip revision or content", async () => {
    const { post } = await create(); const before = await f.snapshot();
    expect(await f.api.getPost!({ ...f.context(), postId: post.id })).toEqual({ ok: true, value: post });
    expect(await f.api.listPosts!(f.context())).toEqual({ ok: true, value: [post] });
    expect(await f.snapshot()).toEqual(before);
  });

  it("serializes two partial edits without losing either field", async () => {
    const { post } = await create();
    const results = await Promise.all([f.api.updatePost!({ ...f.context(), postId: post.id, description: "Edited" }),
      f.api.updatePost!({ ...f.context(), postId: post.id, mapsUrl: "Maps" })]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await f.api.getPost!({ ...f.context(), postId: post.id })).toMatchObject({ ok: true, value: { description: "Edited", mapsUrl: "Maps" } });
  });

  it("serializes joint creation with Trip deletion without orphaning either record", async () => {
    expect(f.api.createPost).toBeTypeOf("function");
    await f.db.collection("tripMembers").updateOne({ tripId: f.trip }, { $set: { role: "admin" } });
    const [created, deleted] = await Promise.all([f.api.createPost!({ ...f.input(), newActivity: { title: "Cena", scheduledAt: f.occurrence } }), f.api.delete!(f.context())]);
    expect(deleted.ok).toBe(true);
    if (!created.ok) expect(created.error.tag).toBe("TripNotFoundError");
    expect(await f.db.collection("posts").countDocuments({ tripId: f.trip })).toBe(0);
    expect(await f.db.collection("activities").countDocuments({ tripId: f.trip })).toBe(0);
  });

  it("serializes relink with activity deletion and leaves no dangling activity reference", async () => {
    const { post } = await create();
    const activity = await f.api.createActivity!({ ...f.context(), dayId: domainId(f.day), title: "Cena", scheduledAt: f.occurrence });
    if (!activity.ok) throw activity.error;
    const [linked, deleted] = await Promise.all([f.api.updatePost!({ ...f.context(), postId: post.id, activityId: activity.value.id }),
      f.api.deleteActivity!({ ...f.context(), activityId: activity.value.id })]);
    expect(deleted.ok).toBe(true);
    if (!linked.ok) expect(linked.error.tag).toBe("ValidationError");
    expect(await f.db.collection("posts").findOne({ _id: new ObjectId(post.id) })).toMatchObject({ activityId: null, authorId: f.actor });
  });

  it("serializes creation with expulsion and rejects further reads and edits", async () => {
    expect(f.api.createPost).toBeTypeOf("function");
    const admin = new ObjectId(); await f.db.collection("tripMembers").insertOne({ tripId: f.trip, userId: admin, role: "admin" });
    const [created, expelled] = await Promise.all([f.api.createPost!(f.input()),
      f.api.expelMember!({ tripId: domainId(f.trip), actorUserId: domainId(admin), targetUserId: domainId(f.actor) })]);
    expect(expelled.ok).toBe(true);
    if (!created.ok) expect(created.error.tag).toBe("TripNotFoundError");
    expect(await f.api.listPosts!(f.context())).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(await f.api.createPost!(f.input())).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    if (created.ok) expect(await f.api.updatePost!({ ...f.context(), postId: created.value.post.id, description: "No" }))
      .toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
  });

  it("serializes post creation with removal of its day by transport regeneration", async () => {
    const outbound = await f.configureTransports();
    const transit = await f.db.collection("itineraryDays").findOne({ tripId: f.trip, type: "transit_out" });
    expect(transit).not.toBeNull(); f.day = transit!._id;
    expect(f.api.createPost).toBeTypeOf("function");
    const [created, changed] = await Promise.all([f.api.createPost!(f.input()), f.api.updateTransport!({ ...f.context(), destinationId: domainId(f.destination),
      transportId: outbound.id, departureAt: new Date("2026-09-24T08:00:00Z"), arrivalAt: new Date("2026-09-24T10:00:00Z") })]);
    expect(created.ok || changed.ok).toBe(true);
    expect(created.ok && changed.ok).toBe(false);
    if (!created.ok) expect(created.error.tag).toBe("ValidationError");
    if (!changed.ok) expect(changed.error.tag).toBe("ItineraryConflictError");
    for (const post of await f.db.collection("posts").find({ tripId: f.trip }).toArray())
      expect(await f.db.collection("itineraryDays").findOne({ _id: post.dayId, tripId: f.trip })).not.toBeNull();
  });
});
