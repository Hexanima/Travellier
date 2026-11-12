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
    if (result.value.outcome !== "created") throw new Error("Post not created.");
    return result.value;
  };

  it("persists BSON references and dates and preserves authorship and publication time when the author edits", async () => {
    const { post } = await create();
    const stored = await f.db.collection("posts").findOne({ _id: new ObjectId(post.id) });
    expect(stored).toMatchObject({ tripId: f.trip, authorId: f.actor, activityId: null, parentPostId: null, transportId: null });
    expect(stored).not.toHaveProperty("dayId");
    expect(stored!.createdAt).toBeInstanceOf(Date);
    expect(await f.api.updatePost!({ ...f.context(), postId: post.id, description: "Editado" }))
      .toEqual({ ok: true, value: { ...post, description: "Editado" } });
    expect(await f.api.getPost!({ ...f.context(), postId: post.id })).toMatchObject({ ok: true, value: { authorId: post.authorId, createdAt: post.createdAt } });
  });

  describe("content editing is reserved to the author (T124)", () => {
    const joinAs = async (role: "admin" | "participant") => {
      const user = new ObjectId(); await f.db.collection("tripMembers").insertOne({ tripId: f.trip, userId: user, role, joinedAt: new Date() });
      return domainId(user);
    };
    const photoKey = (n: number) => `trips/${f.trip.toHexString()}/photos/${f.actor.toHexString()}/00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}.jpg`;
    const dump = async () => Promise.all(["posts", "postPhotos", "postExpenses", "activities", "activityParticipations", "outboxEvents"]
      .map((name) => f.db.collection(name).find().sort({ _id: 1 }).toArray()));

    it.each(["admin", "participant"] as const)("answers 403 to a %s who is not the author, in content and in a mixed PATCH, leaving everything intact", async (role) => {
      const { post } = await create(); const other = await joinAs(role);
      await f.db.collection("postPhotos").insertOne({ tripId: f.trip, postId: new ObjectId(post.id), s3Key: "kept", order: 1, uploaderId: f.actor });
      const before = await dump(), snapshot = await f.snapshot();
      const expense = { totalAmount: 100, currency: "ARS" };
      for (const fields of [{ description: "Editado" }, { mapsUrl: "m" }, { description: "Editado", expense }, { photos: [{ key: photoKey(1) }] },
        { activityId: null }]) {
        expect(await f.api.updatePost!({ ...f.context(), authenticatedUserId: other, postId: post.id, ...fields }))
          .toMatchObject({ ok: false, error: { tag: "UnauthorizedError" } });
      }
      expect(await dump()).toEqual(before); expect(await f.snapshot()).toEqual(snapshot);
    });

    it("lets another member edit only the expense, and a non member keeps getting 404", async () => {
      const { post } = await create(); const other = await joinAs("participant");
      const expense = { totalAmount: 100, currency: "ARS" };
      expect(await f.api.updatePost!({ ...f.context(), authenticatedUserId: other, postId: post.id, expense }))
        .toMatchObject({ ok: true, value: { expense: { totalAmount: 100, currency: "ARS" } } });
      expect(await f.db.collection("postExpenses").countDocuments({ postId: new ObjectId(post.id) })).toBe(1);
      expect(await f.db.collection("posts").findOne({ _id: new ObjectId(post.id) })).toMatchObject({ description: "Recuerdo" });
      expect(await f.api.updatePost!({ ...f.context(), authenticatedUserId: domainId(new ObjectId()), postId: post.id, description: "No" }))
        .toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    });

    it("lets the author keep retrying the same save without new writes (T87)", async () => {
      const { post } = await create(); const body = { ...f.context(), postId: post.id, description: "Editado", expense: { totalAmount: 100, currency: "ARS" } };
      expect(await f.api.updatePost!(body)).toMatchObject({ ok: true });
      const before = await dump();
      expect(await f.api.updatePost!(body)).toMatchObject({ ok: true });
      expect(await dump()).toEqual(before);
    });

    it("nobody edits the content of a former member's memory, who gets 404", async () => {
      const { post } = await create(); const other = await joinAs("admin");
      await f.db.collection("tripMembers").deleteOne({ tripId: f.trip, userId: f.actor });
      expect(await f.api.updatePost!({ ...f.context(), authenticatedUserId: other, postId: post.id, description: "Editado" }))
        .toMatchObject({ ok: false, error: { tag: "UnauthorizedError" } });
      expect(await f.api.updatePost!({ ...f.context(), postId: post.id, description: "Editado" }))
        .toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
      expect(await f.db.collection("posts").findOne({ _id: new ObjectId(post.id) })).toMatchObject({ description: "Recuerdo" });
    });
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
        await f.db.collection(name).insertOne({ tripId: f.trip, postId: new ObjectId(post.id), value: post.id, s3Key: post.id, order: 1 });
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
    expect(await f.db.collection("activityParticipations").countDocuments({ tripId: f.trip })).toBe(0);
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
    await f.releaseOwnership();
    const [created, expelled] = await Promise.all([f.api.createPost!(f.input()),
      f.api.expelMember!({ tripId: domainId(f.trip), actorUserId: domainId(admin), targetUserId: domainId(f.actor) })]);
    expect(expelled.ok).toBe(true);
    if (!created.ok) expect(created.error.tag).toBe("TripNotFoundError");
    expect(await f.api.listPosts!(f.context())).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(await f.api.createPost!(f.input())).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    if (created.ok && created.value.outcome === "created") expect(await f.api.updatePost!({ ...f.context(), postId: created.value.post.id, description: "No" }))
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
    await f.db.collection("posts").insertOne({ _id: legacy, tripId: f.trip, dayId: legacyDay, authorId: f.actor, description: "Viejo",
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

  describe("author's plan on joint creation (T58)", () => {
    const first = () => ({ title: "Cena", scheduledAt: f.occurrence, durationMinutes: 60 });
    const overlapping = () => ({ title: "Postre", scheduledAt: new Date(f.occurrence.getTime() + 30 * 60_000), durationMinutes: 60 });
    const seedGoing = async (scheduledAt: Date) => {
      const created = await f.api.createActivity!({ ...f.context(), dayId: domainId(f.day), title: "Plan", scheduledAt, durationMinutes: 60 });
      if (!created.ok || created.value.outcome !== "created") throw new Error("seed failed");
      return created.value.activity;
    };
    const confirmationOf = (result: { ok: boolean; value?: unknown }) => {
      const value = result.value as { outcome: string; conflicts: unknown[]; activity: unknown };
      expect(value.outcome).toBe("confirmation_required");
      return { confirmedConflicts: value.conflicts, confirmedActivity: value.activity };
    };
    const mockCollection = (name: string, method: "findOneAndUpdate", behavior: (real: (...args: unknown[]) => unknown, call: number) => unknown) => {
      const collection = f.db.collection(name), original = f.db.collection.bind(f.db);
      const real = (collection[method] as (...args: unknown[]) => unknown).bind(collection); let call = 0;
      vi.spyOn(collection, method).mockImplementation(((...args: unknown[]) => behavior(() => real(...args), ++call)) as never);
      vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === name ? collection : original(key, options));
    };

    it("rolls back everything, including the Trip revision, when saving the author's going fails", async () => {
      const before = await f.snapshot();
      mockCollection("activityParticipations", "findOneAndUpdate", () => Promise.reject(new Error("forced failure")));
      expect(await f.api.createPost!({ ...f.input(), dayId: domainId(f.day), newActivity: first() })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(await f.snapshot()).toEqual(before);
    });

    it("rolls back the previous not_going and the whole creation when the second participation write fails", async () => {
      const a = await seedGoing(new Date(f.occurrence.getTime() + 30 * 60_000)), b = await seedGoing(new Date(f.occurrence.getTime() - 30 * 60_000));
      const confirmation = confirmationOf(await f.api.createPost!({ ...f.input(), newActivity: first() }));
      const before = await f.snapshot();
      mockCollection("activityParticipations", "findOneAndUpdate", (real, call) => call === 2 ? Promise.reject(new Error("forced failure")) : real());
      expect(await f.api.createPost!({ ...f.input(), newActivity: first(), ...confirmation })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(await f.snapshot()).toEqual(before);
      const statuses = (await f.db.collection("activityParticipations").find().toArray()).map((p) => [p.activityId.toHexString(), p.status]);
      expect(Object.fromEntries(statuses)).toEqual({ [a.id]: "going", [b.id]: "going" });
    });

    it("lets only one of two overlapping creations by the same author become going", async () => {
      for (let round = 0; round < 3; round++) {
        await f.reset();
        const results = await Promise.all([f.api.createPost!({ ...f.input(), newActivity: first() }), f.api.createPost!({ ...f.input(), newActivity: overlapping() })]);
        const outcomes = results.map((r) => r.ok ? r.value.outcome : r.error.tag).sort();
        expect(outcomes).toEqual(["confirmation_required", "created"]);
        expect(await f.db.collection("posts").countDocuments({ tripId: f.trip })).toBe(1);
        expect(await f.db.collection("activities").countDocuments({ tripId: f.trip })).toBe(1);
        expect(await f.db.collection("activityParticipations").find({ tripId: f.trip }).toArray()).toMatchObject([{ status: "going", userId: f.actor }]);
      }
    });

    it("asks again with a stale confirmation without persisting anything of the post", async () => {
      await seedGoing(new Date(f.occurrence.getTime() + 30 * 60_000));
      const confirmation = confirmationOf(await f.api.createPost!({ ...f.input(), newActivity: first() }));
      await seedGoing(new Date(f.occurrence.getTime() - 30 * 60_000));
      const before = (await f.snapshot()).slice(1);
      const result = await f.api.createPost!({ ...f.input(), newActivity: first(), ...confirmation });
      expect(result).toMatchObject({ ok: true, value: { outcome: "confirmation_required" } });
      expect((await f.snapshot()).slice(1)).toEqual(before);
    });

    it("keeps serialized creation and relink with Trip deletion free of orphan posts, activities and participations", async () => {
      await f.db.collection("tripMembers").updateOne({ tripId: f.trip }, { $set: { role: "admin" } });
      const { post } = await create();
      const [created, linked, deleted] = await Promise.all([f.api.createPost!({ ...f.input(), newActivity: first() }),
        f.api.linkPostToNewActivity!({ ...f.context(), postId: post.id, newActivity: overlapping() }), f.api.delete!(f.context())]);
      expect(deleted.ok).toBe(true);
      for (const result of [created, linked]) if (!result.ok) expect(result.error.tag).toMatch(/TripNotFoundError|PostNotFoundError/);
      for (const name of ["posts", "activities", "activityParticipations"]) expect(await f.db.collection(name).countDocuments({ tripId: f.trip })).toBe(0);
    });

    it("keeps the relink and the deletion of the previous activity consistent in either serialized order", async () => {
      const { post } = await create();
      const linked = await f.api.linkPostToNewActivity!({ ...f.context(), postId: post.id, newActivity: first() });
      if (!linked.ok || linked.value.outcome !== "linked") throw new Error("relink failed");
      const previousId = linked.value.activity.id;
      const farAway = { ...first(), title: "Lejos", scheduledAt: new Date(f.occurrence.getTime() + 3 * 3_600_000) };
      const [relinked, deleted] = await Promise.all([f.api.linkPostToNewActivity!({ ...f.context(), postId: post.id, newActivity: farAway }),
        f.api.deleteActivity!({ ...f.context(), activityId: previousId })]);
      // The relink never touches the previous activity and the deletion only targets it: both orders end in the same exact state.
      expect(deleted.ok).toBe(true);
      if (!relinked.ok || relinked.value.outcome !== "linked") throw new Error("expected the relink to be linked in both orders");
      const newId = relinked.value.activity.id;
      expect(newId).not.toBe(previousId);
      const stored = await f.db.collection("posts").findOne({ _id: new ObjectId(post.id) });
      expect(stored!.activityId.toHexString()).toBe(newId);
      const activities = await f.db.collection("activities").find({ tripId: f.trip }).toArray();
      expect(activities.map((a) => a._id.toHexString())).toEqual([newId]);
      const participations = await f.db.collection("activityParticipations").find({ tripId: f.trip }).toArray();
      expect(participations).toMatchObject([{ status: "going", userId: f.actor }]);
      expect(participations[0].activityId.toHexString()).toBe(newId);
      expect(await f.db.collection("activityParticipations").countDocuments({ activityId: new ObjectId(previousId) })).toBe(0);
    });

    it("lets only one of two overlapping relinks of different posts by the same author become linked", async () => {
      for (let round = 0; round < 3; round++) {
        await f.reset();
        const posts = [(await create()).post, (await create()).post];
        const results = await Promise.all([f.api.linkPostToNewActivity!({ ...f.context(), postId: posts[0]!.id, newActivity: first() }),
          f.api.linkPostToNewActivity!({ ...f.context(), postId: posts[1]!.id, newActivity: overlapping() })]);
        expect(results.map((r) => r.ok ? r.value.outcome : r.error.tag).sort()).toEqual(["confirmation_required", "linked"]);
        const winnerIndex = results.findIndex((r) => r.ok && r.value.outcome === "linked");
        const winner = results[winnerIndex];
        if (!winner || !winner.ok || winner.value.outcome !== "linked") throw new Error("no winner");
        const stored = await Promise.all(posts.map((p) => f.db.collection("posts").findOne({ _id: new ObjectId(p.id) })));
        expect(stored[winnerIndex]!.activityId.toHexString()).toBe(winner.value.activity.id);
        expect(stored[1 - winnerIndex]!.activityId).toBeNull();
        stored.forEach((doc, i) => expect(doc!.createdAt).toEqual(posts[i]!.createdAt));
        const activities = await f.db.collection("activities").find({ tripId: f.trip }).toArray();
        expect(activities.map((a) => a._id.toHexString())).toEqual([winner.value.activity.id]);
        const participations = await f.db.collection("activityParticipations").find({ tripId: f.trip }).toArray();
        expect(participations).toMatchObject([{ status: "going", userId: f.actor }]);
        expect(participations[0].activityId.toHexString()).toBe(winner.value.activity.id);
      }
    });

    it("lets only one of two overlapping relinks of the same post by the same author become linked", async () => {
      for (let round = 0; round < 3; round++) {
        await f.reset();
        const { post } = await create();
        const results = await Promise.all([f.api.linkPostToNewActivity!({ ...f.context(), postId: post.id, newActivity: first() }),
          f.api.linkPostToNewActivity!({ ...f.context(), postId: post.id, newActivity: overlapping() })]);
        expect(results.map((r) => r.ok ? r.value.outcome : r.error.tag).sort()).toEqual(["confirmation_required", "linked"]);
        const winner = results.find((r) => r.ok && r.value.outcome === "linked");
        if (!winner || !winner.ok || winner.value.outcome !== "linked") throw new Error("no winner");
        const stored = await f.db.collection("posts").findOne({ _id: new ObjectId(post.id) });
        expect(stored!.activityId.toHexString()).toBe(winner.value.activity.id);
        expect(stored!.createdAt).toEqual(post.createdAt);
        const activities = await f.db.collection("activities").find({ tripId: f.trip }).toArray();
        expect(activities.map((a) => a._id.toHexString())).toEqual([winner.value.activity.id]);
        const participations = await f.db.collection("activityParticipations").find({ tripId: f.trip }).toArray();
        expect(participations).toMatchObject([{ status: "going", userId: f.actor }]);
        expect(participations[0].activityId.toHexString()).toBe(winner.value.activity.id);
      }
    });
  });
});
