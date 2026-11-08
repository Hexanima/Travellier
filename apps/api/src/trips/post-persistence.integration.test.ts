import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { childPostsQuery } from "../adapters/mongodb/trip-post-repository.js";
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
    expect(stored).toMatchObject({ tripId: f.trip, authorId: f.actor, activityId: null, parentPostId: null, transportId: null });
    expect(stored).not.toHaveProperty("dayId");
    expect(stored!.createdAt).toBeInstanceOf(Date);
    const editor = new ObjectId(); await f.db.collection("tripMembers").insertOne({ tripId: f.trip, userId: editor, role: "admin" });
    expect(await f.api.updatePost!({ ...f.context(), authenticatedUserId: domainId(editor), postId: post.id, description: "Editado" }))
      .toEqual({ ok: true, value: { ...post, description: "Editado" } });
    expect(await f.api.getPost!({ ...f.context(), postId: post.id })).toMatchObject({ ok: true, value: { authorId: post.authorId, createdAt: post.createdAt } });
  });

  it.each([false, true])("stores joint creation with voting=%s and UTC milliseconds", async (votingEnabled) => {
    await f.db.collection("trips").updateOne({ _id: f.trip }, { $set: { votingEnabled } });
    const { post, activity } = await create({ dayId: domainId(f.day), newActivity: { title: "Cena", scheduledAt: f.occurrence } });
    expect(activity).toMatchObject({ scheduledAt: f.occurrence, createdBy: post.authorId });
    expect(activity).not.toHaveProperty("status");
    const stored = await f.db.collection("posts").findOne({ _id: new ObjectId(post.id) });
    expect(stored!.activityId).toEqual(new ObjectId(activity!.id));
    expect(await f.db.collection("activities").findOne({ _id: stored!.activityId })).toMatchObject({ scheduledAt: f.occurrence, dayId: f.day, tripId: f.trip });
  });

  it.each(["posts", "activities"])("rolls back joint creation and Trip revision when %s insertion fails", async (name) => {
    expect(f.api.createPost).toBeTypeOf("function"); const before = await f.snapshot();
    const collection = f.db.collection(name), original = f.db.collection.bind(f.db);
    vi.spyOn(collection, "insertOne").mockRejectedValueOnce(new Error("forced failure"));
    vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === name ? collection : original(key, options));
    expect(await f.api.createPost!({ ...f.input(), dayId: domainId(f.day), newActivity: { title: "Cena", scheduledAt: f.occurrence } }))
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

  it("serializes two opposite parent edits so exactly one wins and no cycle is persisted", async () => {
    const { post: a } = await create(), { post: b } = await create();
    for (let round = 0; round < 3; round++) {
      await f.db.collection("posts").updateMany({}, { $set: { parentPostId: null } });
      const results = await Promise.all([f.api.updatePost!({ ...f.context(), postId: a.id, parentPostId: b.id }),
        f.api.updatePost!({ ...f.context(), postId: b.id, parentPostId: a.id })]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const failed = results.find((r) => !r.ok);
      expect(failed).toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "parentPostId", code: "cycle" }] } });
      const stored = await f.db.collection("posts").find({ tripId: f.trip }).toArray();
      expect(stored.filter((p) => p.parentPostId !== null)).toHaveLength(1);
    }
  });

  it("serializes concurrent edits that could close a longer cycle", async () => {
    const { post: a } = await create(), { post: b } = await create(), { post: c } = await create();
    const results = await Promise.all([f.api.updatePost!({ ...f.context(), postId: a.id, parentPostId: b.id }),
      f.api.updatePost!({ ...f.context(), postId: b.id, parentPostId: c.id }),
      f.api.updatePost!({ ...f.context(), postId: c.id, parentPostId: a.id })]);
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    const stored = new Map((await f.db.collection("posts").find({ tripId: f.trip }).toArray()).map((p) => [p._id.toHexString(), p.parentPostId?.toHexString() ?? null]));
    for (const start of stored.keys()) {
      const seen = new Set<string>(); let next: string | null | undefined = start;
      while (next) { expect(seen.has(next)).toBe(false); seen.add(next); next = stored.get(next); }
    }
  });

  it("rolls back a rejected cycle or conflict without partial writes and keeps associated content", async () => {
    const { post: a } = await create(), { post: b } = await create({ parentPostId: a.id });
    await f.db.collection("postPhotos").insertOne({ tripId: f.trip, postId: new ObjectId(a.id), value: "kept" });
    const before = await f.snapshot();
    expect(await f.api.updatePost!({ ...f.context(), postId: a.id, description: "No", parentPostId: b.id }))
      .toMatchObject({ ok: false, error: { issues: [{ code: "cycle" }] } });
    expect(await f.snapshot()).toEqual(before);
    expect(await f.db.collection("postPhotos").findOne({ postId: new ObjectId(a.id) })).toMatchObject({ value: "kept" });
  });

  it("keeps the chain, publication and content when the root activity is deleted, and stops projecting it", async () => {
    const activity = await f.api.createActivity!({ ...f.context(), dayId: domainId(f.day), title: "Cena", scheduledAt: f.occurrence });
    if (!activity.ok) throw activity.error;
    if (activity.value.outcome !== "created") throw new Error("Activity not created.");
    const activityId = activity.value.activity.id;
    const { post: root } = await create({ activityId, description: "Raiz" });
    const { post: a } = await create({ parentPostId: root.id, description: "A" });
    const { post: b } = await create({ parentPostId: a.id, description: "B" });
    const { post: d } = await create({ parentPostId: a.id, description: "D" });
    for (const post of [root, a, b, d]) {
      for (const name of ["postPhotos", "postExpenses"])
        await f.db.collection(name).insertOne({ tripId: f.trip, postId: new ObjectId(post.id), value: post.id });
    }
    const before = await f.db.collection("posts").find({ tripId: f.trip }).sort({ _id: 1 }).toArray();
    const projected = await f.api.getPostChain!({ ...f.context(), postId: b.id });
    expect(projected).toMatchObject({ ok: true, value: { rootActivityId: activityId } });
    expect((await f.api.deleteActivity!({ ...f.context(), activityId })).ok).toBe(true);
    const after = await f.db.collection("posts").find({ tripId: f.trip }).sort({ _id: 1 }).toArray();
    expect(after).toEqual(before.map((p) => p._id.toHexString() === root.id ? { ...p, activityId: null } : p));
    for (const post of [b, d]) {
      expect(await f.api.getPostChain!({ ...f.context(), postId: post.id }))
        .toMatchObject({ ok: true, value: { rootActivityId: null, parent: { id: a.id } } });
    }
    expect(await f.api.getPostChain!({ ...f.context(), postId: a.id }))
      .toMatchObject({ ok: true, value: { parent: { id: root.id }, children: expect.any(Array) } });
    for (const name of ["postPhotos", "postExpenses"])
      expect(await f.db.collection(name).countDocuments({ tripId: f.trip })).toBe(4);
  });

  it("runs the exact listChildren query as an index scan without COLLSCAN", async () => {
    const { post: root } = await create();
    await create({ parentPostId: root.id });
    const { filter, sort } = childPostsQuery(f.trip, new ObjectId(root.id));
    const plan = await f.db.collection("posts").find(filter).sort(sort).explain("queryPlanner");
    const winning = JSON.stringify(plan.queryPlanner.winningPlan);
    expect(winning).toContain("IXSCAN");
    expect(winning).not.toContain("COLLSCAN");
    expect(winning).toContain('"stage":"IXSCAN","keyPattern":{"parentPostId":1},"indexName":"parentPostId"');
  });

  it("serializes joint creation with Trip deletion without orphaning either record", async () => {
    expect(f.api.createPost).toBeTypeOf("function");
    await f.db.collection("tripMembers").updateOne({ tripId: f.trip }, { $set: { role: "admin" } });
    const [created, deleted] = await Promise.all([f.api.createPost!({ ...f.input(), dayId: domainId(f.day), newActivity: { title: "Cena", scheduledAt: f.occurrence } }), f.api.delete!(f.context())]);
    expect(deleted.ok).toBe(true);
    if (!created.ok) expect(created.error.tag).toBe("TripNotFoundError");
    expect(await f.db.collection("posts").countDocuments({ tripId: f.trip })).toBe(0);
    expect(await f.db.collection("activities").countDocuments({ tripId: f.trip })).toBe(0);
  });

  it("serializes relink with activity deletion and leaves no dangling activity reference", async () => {
    const { post } = await create();
    const activity = await f.api.createActivity!({ ...f.context(), dayId: domainId(f.day), title: "Cena", scheduledAt: f.occurrence });
    if (!activity.ok) throw activity.error;
    if (activity.value.outcome !== "created") throw new Error("Activity not created.");
    const [linked, deleted] = await Promise.all([f.api.updatePost!({ ...f.context(), postId: post.id, activityId: activity.value.activity.id }),
      f.api.deleteActivity!({ ...f.context(), activityId: activity.value.activity.id })]);
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

  it("creates posts concurrently with transport regeneration without conflicts, leaving the itinerary untouched by them", async () => {
    const outbound = await f.configureTransports();
    expect(f.api.createPost).toBeTypeOf("function");
    const [created, changed] = await Promise.all([f.api.createPost!(f.input()), f.api.updateTransport!({ ...f.context(), destinationId: domainId(f.destination),
      transportId: outbound.id, departureAt: new Date("2026-09-24T08:00:00Z"), arrivalAt: new Date("2026-09-24T10:00:00Z") })]);
    expect(created.ok).toBe(true); expect(changed.ok).toBe(true);
    expect(await f.db.collection("posts").countDocuments({ tripId: f.trip })).toBe(1);
  });

  it.each([
    ["before the Trip", "2020-01-01T00:00:00.001Z"], ["after the Trip", "2031-12-31T23:59:59.999Z"],
  ])("stores and lists a post published %s without any itinerary", async (_name, iso) => {
    await f.db.collection("itineraryDays").deleteMany({ tripId: f.trip });
    const { post } = await create();
    await f.db.collection("posts").updateOne({ _id: new ObjectId(post.id) }, { $set: { createdAt: new Date(iso) } });
    const listed = await f.api.listPosts!(f.context());
    expect(listed).toMatchObject({ ok: true, value: [{ id: post.id, createdAt: new Date(iso) }] });
    const edited = await f.api.updatePost!({ ...f.context(), postId: post.id, description: "Editado" });
    expect(edited).toMatchObject({ ok: true, value: { createdAt: new Date(iso), authorId: post.authorId } });
    expect((await f.db.collection("posts").findOne({ _id: new ObjectId(post.id) }))!.createdAt).toEqual(new Date(iso));
  });

  it.each(["existing", "missing"])("reads, edits and preserves a legacy dayId pointing to an %s day", async (kind) => {
    const legacyDay = kind === "existing" ? f.day : new ObjectId(), legacy = new ObjectId();
    const createdAt = new Date("2026-09-20T10:00:00.987Z");
    await f.db.collection("posts").insertOne({ _id: legacy, tripId: f.trip, dayId: legacyDay, authorId: new ObjectId(), description: "Viejo",
      mapsUrl: null, activityId: null, parentPostId: null, transportId: null, createdAt });
    const id = domainId(legacy);
    const read = await f.api.getPost!({ ...f.context(), postId: id });
    expect(read).toMatchObject({ ok: true, value: { id, createdAt } });
    if (read.ok) expect(read.value).not.toHaveProperty("dayId");
    expect(await f.api.updatePost!({ ...f.context(), postId: id, description: "Nuevo" })).toMatchObject({ ok: true, value: { createdAt } });
    expect(await f.db.collection("posts").findOne({ _id: legacy })).toMatchObject({ dayId: legacyDay, description: "Nuevo", createdAt });
  });

  it("lists with createdAt descending and id descending using the tripId_createdAt_desc index", async () => {
    const at = new Date("2026-10-01T00:00:00.001Z");
    const ids = [new ObjectId(), new ObjectId(), new ObjectId()].sort((a, b) => a.toHexString().localeCompare(b.toHexString()));
    await f.db.collection("posts").insertMany(ids.map((_id) => ({ _id, tripId: f.trip, authorId: f.actor, createdAt: at,
      description: null, mapsUrl: null, activityId: null, parentPostId: null, transportId: null })));
    const listed = await f.api.listPosts!(f.context());
    expect(listed.ok && listed.value.map((p) => p.id)).toEqual([...ids].reverse().map((id) => id.toHexString()));
    const plan = await f.db.collection("posts").find({ tripId: f.trip }).sort({ createdAt: -1 }).explain("queryPlanner");
    expect(JSON.stringify(plan.queryPlanner.winningPlan)).toContain("tripId_createdAt_desc");
    expect(JSON.stringify(plan.queryPlanner.winningPlan)).not.toMatch(/COLLSCAN|"SORT"/);
  });
});
