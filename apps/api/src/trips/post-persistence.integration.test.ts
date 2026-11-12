import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { processStorageDeletionJobs } from "app-domain";
import { childPostsQuery } from "../adapters/mongodb/trip-post-repository.js";
import { createMongoPhotoLinkRepository } from "../adapters/mongodb/photo-link-repository.js";
import { createMongoStorageDeletionJobRepository } from "../adapters/mongodb/storage-deletion-job-repository.js";
import { FakeCleanupStorage } from "../../test/fake-cleanup-storage.js";
import { FakeObjectStorage } from "../../test/fake-object-storage.js";
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

  describe("removing photos and expense while editing (T127)", () => {
    let fake: FakeObjectStorage;
    beforeEach(async () => { fake = new FakeObjectStorage(); f.storage = fake; await f.reset(); });
    afterAll(() => { f.storage = undefined; });

    const keyFor = () => {
      const key = `trips/${f.trip}/photos/${f.actor}/${randomUUID()}.jpg`;
      fake.put(key, "image/jpeg");
      return key;
    };
    const joinAs = async (role: "admin" | "participant") => {
      const user = new ObjectId(); await f.db.collection("tripMembers").insertOne({ tripId: f.trip, userId: user, role, joinedAt: new Date() });
      return user;
    };
    const pct = (userId: ObjectId) => ({ userId: userId.toHexString(), unit: "percent", value: 100 });
    const rest = (userId: ObjectId) => ({ userId: userId.toHexString(), unit: "remainder", value: null });
    /** A post with `count` photos; `refs[i]` is the photo uploaded with `keys[i]`. */
    const withPhotos = async (count: number, fields: object = {}) => {
      const keys = Array.from({ length: count }, keyFor);
      const { post, photos } = await create({ photos: keys.map((key) => ({ key })), ...fields });
      return { post, keys, refs: photos!.map((photo) => ({ id: photo.id })) };
    };
    const patch = (postId: string, fields: object, user: ObjectId = f.actor) =>
      f.api.updatePost!({ ...f.context(), authenticatedUserId: domainId(user), postId: domainId(new ObjectId(postId)), ...fields });
    const stored = async (postId: string) => (await f.db.collection("postPhotos").find({ postId: new ObjectId(postId) }).sort({ order: 1 }).toArray());
    const dump = async () => Promise.all(["posts", "postPhotos", "postExpenses", "storageDeletionJobs", "outboxEvents"]
      .map((name) => f.db.collection(name).find().sort({ _id: 1 }).toArray()));
    const jobs = () => f.db.collection("storageDeletionJobs").find().toArray();

    it("removes only the chosen documents, renumbers without hitting the unique index even when the first of three goes, and queues one pending job", async () => {
      const { post, keys, refs } = await withPhotos(3);
      const other = await withPhotos(2);
      const otherBefore = await stored(other.post.id);
      const result = await patch(post.id, { removePhotos: [refs[0]!] });
      expect(result).toMatchObject({ ok: true, value: { photos: [{ id: refs[1]!.id, order: 1 }, { id: refs[2]!.id, order: 2 }] } });
      expect((await stored(post.id)).map((p) => [p.s3Key, p.order])).toEqual([[keys[1], 1], [keys[2], 2]]);
      expect(await stored(other.post.id)).toEqual(otherBefore);
      const queued = await jobs();
      expect(queued).toHaveLength(1);
      expect(queued[0]).toMatchObject({ tripId: f.trip, status: "pending", attempts: 0, objectKeys: [keys[0]], resolvedKeys: [], rejectedKeys: [] });
    });

    it("removes the middle and the last ones, and several at once in a single job", async () => {
      const { post, keys, refs } = await withPhotos(4);
      expect((await patch(post.id, { removePhotos: [refs[1]!] })).ok).toBe(true);
      expect((await stored(post.id)).map((p) => p.order)).toEqual([1, 2, 3]);
      expect((await patch(post.id, { removePhotos: [refs[3]!, refs[0]!] })).ok).toBe(true);
      expect((await stored(post.id)).map((p) => [p.s3Key, p.order])).toEqual([[keys[2], 1]]);
      const queued = await jobs();
      expect(queued.map((job) => [...job.objectKeys].sort())).toEqual([[keys[1]], [keys[0], keys[3]].sort()]);
    });

    it("appends a new photo after the renumbered ones in the same PATCH", async () => {
      const { post, keys, refs } = await withPhotos(2);
      const added = keyFor();
      expect(await patch(post.id, { removePhotos: [refs[0]!], photos: [{ key: added }] })).toMatchObject({ ok: true });
      expect((await stored(post.id)).map((p) => [p.s3Key, p.order])).toEqual([[keys[1], 1], [added, 2]]);
      expect((await jobs())[0]).toMatchObject({ objectKeys: [keys[0]] });
    });

    it("the storage worker deletes the removed key only, and not one that was linked again elsewhere", async () => {
      const { post, keys, refs } = await withPhotos(3);
      const kept = await withPhotos(1);
      expect((await patch(post.id, { removePhotos: [refs[0]!, refs[1]!] })).ok).toBe(true);
      // The object still exists: another memory links it before the cleanup runs.
      expect((await patch(kept.post.id, { photos: [{ key: keys[1]! }] })).ok).toBe(true);
      const cleanup = new FakeCleanupStorage();
      for (const key of [...keys, ...kept.keys]) cleanup.put(key, new Date("2026-01-01T00:00:00Z"));
      const now = new Date(Date.now() + 60_000);
      const result = await processStorageDeletionJobs({ jobs: createMongoStorageDeletionJobRepository(f.db), links: createMongoPhotoLinkRepository(f.db), storage: cleanup,
        now: () => now, createOwner: () => "owner", deadline: new Date(now.getTime() + 45_000), maxJobs: 10 });
      expect(result).toMatchObject({ ok: true, value: { processed: 1, completed: 1, resolvedKeys: 1, rejectedKeys: 1 } });
      expect([...cleanup.deleted]).toEqual([keys[0]]);
      expect(cleanup.keys().sort()).toEqual([keys[1], keys[2], ...kept.keys].sort());
    });

    describe("minimum content", () => {
      it("rejects removing the last photo of a post without text or location, leaving the snapshot identical and no job", async () => {
        const { post, refs } = await withPhotos(2, { description: null });
        expect((await patch(post.id, { removePhotos: [refs[0]!] })).ok).toBe(true);
        const before = await dump(), jobsBefore = (await jobs()).length;
        expect(await patch(post.id, { removePhotos: [refs[1]!] })).toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ code: "required" }] } });
        expect(await dump()).toEqual(before); expect((await jobs()).length).toBe(jobsBefore);
        expect(await patch(post.id, { description: "Ahora con texto", removePhotos: [refs[1]!] })).toMatchObject({ ok: true, value: { photos: [] } });
        expect(await stored(post.id)).toEqual([]);
      });
      it("clearing the text while removing the last photo is rejected as a whole", async () => {
        const { post, refs } = await withPhotos(1);
        const before = await dump();
        expect(await patch(post.id, { description: null, removePhotos: [refs[0]!] })).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
        expect(await dump()).toEqual(before);
      });
    });

    describe("expense: null", () => {
      it("deletes only the expense of the post, answers the post without the expense and omits it in the detail", async () => {
        const post = (await create({ expense: { totalAmount: 10, currency: "ARS" } })).post;
        const kept = (await create({ expense: { totalAmount: 20, currency: "ARS" } })).post;
        const result = await patch(post.id, { expense: null });
        expect(result.ok && "expense" in result.value).toBe(false);
        expect(await f.db.collection("postExpenses").find().toArray()).toMatchObject([{ postId: new ObjectId(kept.id) }]);
        const detail = await f.api.getPostChain!({ ...f.context(), postId: post.id });
        expect(detail.ok && "expense" in detail.value).toBe(false);
      });

      it("recomputes the balance after removing the expense, keeping an incomplete expense excluded", async () => {
        await f.db.collection("trips").updateOne({ _id: f.trip }, { $set: { expenseMode: "balance" } });
        const other = await joinAs("participant");
        const full = (total: number, payer: ObjectId) => ({ totalAmount: total, currency: "ARS", payments: [pct(payer)], shares: [rest(f.actor), rest(other)] });
        const first = (await create({ expense: full(100, f.actor) })).post, second = (await create({ expense: full(40, other) })).post;
        await create({ expense: { totalAmount: 30, currency: "ARS", payments: [pct(f.actor)] } });
        const balance = async () => { const r = await f.api.getBalance!(f.context()); if (!r.ok) throw r.error; return r.value; };
        const net = (value: Awaited<ReturnType<typeof balance>>, user: ObjectId) =>
          value.currencies.find((c) => c.currency === "ARS")?.balances.find((row) => row.userId === user.toHexString())?.netCents;
        const before = await balance();
        expect([before.includedExpenseCount, net(before, f.actor), net(before, other)]).toEqual([2, 3000, -3000]);
        expect((await patch(second.id, { expense: null }, other)).ok).toBe(true);
        const after = await balance();
        expect([after.includedExpenseCount, net(after, f.actor), net(after, other)]).toEqual([1, 5000, -5000]);
        expect(after.excludedExpenses).toHaveLength(1);
        expect((await patch(first.id, { expense: null })).ok).toBe(true);
        expect((await balance()).includedExpenseCount).toBe(0);
      });

      it("without a stored expense it writes nothing", async () => {
        const { post } = await create(); const before = await dump();
        expect(await patch(post.id, { expense: null })).toMatchObject({ ok: true });
        expect(await dump()).toEqual(before);
      });
    });

    it("answers a retry of a PATCH that removed photos, the expense and edited the text without new writes or jobs (T87)", async () => {
      const { post, refs } = await withPhotos(3, { expense: { totalAmount: 10, currency: "ARS" } });
      const body = { description: "Editado", removePhotos: [refs[1]!], expense: null };
      expect(await patch(post.id, body)).toMatchObject({ ok: true });
      const before = await dump();
      expect(await patch(post.id, body)).toMatchObject({ ok: true, value: { description: "Editado", photos: [{ id: refs[0]!.id, order: 1 }, { id: refs[2]!.id, order: 2 }] } });
      expect(await dump()).toEqual(before); expect(await jobs()).toHaveLength(1);
    });

    it("lets a participant who is not the author remove the expense but answers 403 to removePhotos, with no changes", async () => {
      const { post, refs } = await withPhotos(2, { expense: { totalAmount: 10, currency: "ARS" } });
      const other = await joinAs("participant"), admin = await joinAs("admin"); const before = await dump();
      for (const user of [other, admin]) {
        expect(await patch(post.id, { removePhotos: [refs[0]!] }, user)).toMatchObject({ ok: false, error: { tag: "UnauthorizedError" } });
        expect(await patch(post.id, { removePhotos: [refs[0]!], expense: null }, user)).toMatchObject({ ok: false, error: { tag: "UnauthorizedError" } });
      }
      expect(await dump()).toEqual(before);
      expect(await patch(post.id, { expense: null }, other)).toMatchObject({ ok: true });
      expect(await f.db.collection("postExpenses").countDocuments()).toBe(0);
      expect(await stored(post.id)).toHaveLength(2); expect(await jobs()).toHaveLength(0);
    });

    it("ignores an unknown photo and one of another Trip, and rejects one of another post of this Trip, without writes", async () => {
      const { post, refs } = await withPhotos(2); const other = await withPhotos(1);
      const tripB = new ObjectId(), photoB = new ObjectId();
      await f.db.collection("postPhotos").insertOne({ _id: photoB, tripId: tripB, postId: new ObjectId(), uploaderId: f.actor, s3Key: "trips/b/x.jpg", order: 1, uploadedAt: new Date() });
      const before = await dump();
      expect(await patch(post.id, { removePhotos: [{ id: new ObjectId().toHexString() }, { id: photoB.toHexString() }] }))
        .toMatchObject({ ok: true, value: { photos: [{ id: refs[0]!.id, order: 1 }, { id: refs[1]!.id, order: 2 }] } });
      expect(await dump()).toEqual(before);
      expect(await patch(post.id, { removePhotos: [other.refs[0]!] })).toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "removePhotos[0].id", code: "not_in_post" }] } });
      expect(await dump()).toEqual(before);
    });

    describe("rollback", () => {
      const failWith = (name: string, method: "insertOne" | "updateOne" | "deleteMany") => {
        const collection = f.db.collection(name), original = f.db.collection.bind(f.db);
        vi.spyOn(collection, method).mockRejectedValueOnce(new Error("forced failure"));
        vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === name ? collection : original(key, options));
      };
      it.each([["storageDeletionJobs", "insertOne"], ["postPhotos", "deleteMany"], ["postPhotos", "updateOne"], ["postExpenses", "deleteMany"]] as const)(
        "a failure in %s.%s leaves no photo, order, expense or job changed", async (name, method) => {
          const { post, refs } = await withPhotos(3, { expense: { totalAmount: 10, currency: "ARS" } });
          const before = await dump();
          failWith(name, method);
          expect(await patch(post.id, { removePhotos: [refs[0]!], expense: null })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
          vi.restoreAllMocks();
          expect(await dump()).toEqual(before);
        });
    });

    describe("concurrency", () => {
      it("two PATCH that remove the same photo serialize: both succeed and a single job holds the key", async () => {
        for (let round = 0; round < 3; round++) {
          await f.reset();
          const { post, keys, refs } = await withPhotos(3);
          const results = await Promise.all([patch(post.id, { removePhotos: [refs[0]!] }), patch(post.id, { removePhotos: [refs[0]!] })]);
          expect(results.map((r) => r.ok)).toEqual([true, true]);
          expect((await stored(post.id)).map((p) => [p.s3Key, p.order])).toEqual([[keys[1], 1], [keys[2], 2]]);
          const queued = await jobs();
          expect(queued).toHaveLength(1); expect(queued[0]).toMatchObject({ objectKeys: [keys[0]] });
        }
      });

      it("removing a photo while the post is deleted serializes without duplicating a key in the jobs", async () => {
        for (let round = 0; round < 3; round++) {
          await f.reset();
          const { post, keys, refs } = await withPhotos(2);
          const [edited, deleted] = await Promise.all([patch(post.id, { removePhotos: [refs[0]!] }),
            f.api.deletePost!({ ...f.context(), postId: domainId(new ObjectId(post.id)) })]);
          expect(deleted.ok).toBe(true);
          if (!edited.ok) expect(edited.error.tag).toBe("PostNotFoundError");
          const queuedKeys = (await jobs()).flatMap((job) => job.objectKeys as string[]);
          expect(queuedKeys.sort()).toEqual([...keys].sort());
          expect(new Set(queuedKeys).size).toBe(queuedKeys.length);
          expect(await f.db.collection("postPhotos").countDocuments()).toBe(0);
        }
      });
    });
  });
});
