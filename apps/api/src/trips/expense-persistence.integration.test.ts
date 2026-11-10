import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { PostFixture, domainId } from "../../test/post-fixture.js";
import { FakeObjectStorage } from "../../test/fake-object-storage.js";

describe("post expense persistence and transactions (T79)", () => {
  const f = new PostFixture();
  let fake: FakeObjectStorage;
  beforeAll(() => f.start("expense_persistence"), 120_000);
  afterAll(() => f.stop());
  // Releases of every pause created by a test. afterEach always frees them (idempotent), so a failed assertion never leaves
  // a transaction open that would block the next reset until the server aborts it. It also waits for every operation the
  // test launched (never launched before `reached` is confirmed, except the one that holds the pause), so none can still
  // run during the next test's reset().
  let pendingReleases: Array<() => void> = [];
  let launched: Array<Promise<unknown>> = [];
  afterEach(async () => {
    for (const release of pendingReleases) release();
    pendingReleases = [];
    await Promise.allSettled(launched);
    launched = [];
  });
  beforeEach(async () => { vi.restoreAllMocks(); fake = new FakeObjectStorage(); f.storage = fake; await f.reset(); });

  const expense = { totalAmount: 1500.5, currency: "ARS", breakdown: "agua 500, entrada 1000" };
  const scheduled = (iso: string) => ({ title: "Cena", scheduledAt: new Date(iso), durationMinutes: 60 });
  const addMember = async (role: "admin" | "participant", tripId = f.trip) => {
    const userId = new ObjectId();
    await f.db.collection("tripMembers").insertOne({ tripId, userId, role, joinedAt: new Date() });
    return userId;
  };
  const createPost = (fields: object = {}, user = f.actor) =>
    f.api.createPost!({ ...f.context(), authenticatedUserId: domainId(user), description: "Recuerdo", ...fields });
  const updatePost = (postId: string, fields: object, user = f.actor) =>
    f.api.updatePost!({ ...f.context(), authenticatedUserId: domainId(user), postId: domainId(new ObjectId(postId)), ...fields });
  const created = async (fields: object = {}) => {
    const result = await createPost(fields);
    if (!result.ok || result.value.outcome !== "created") throw new Error(`Post not created: ${JSON.stringify(result)}`);
    return result.value;
  };
  const edited = async (postId: string, fields: object) => {
    const result = await updatePost(postId, fields);
    if (!result.ok) throw new Error(`Post not edited: ${JSON.stringify(result)}`);
    return result.value;
  };
  const snapshot = () => Promise.all(["trips", "posts", "postPhotos", "postExpenses", "activities", "activityParticipations", "tripMembers"]
    .map((name) => f.db.collection(name).find().sort({ _id: 1 }).toArray()));
  const expenses = () => f.db.collection("postExpenses").find().sort({ _id: 1 }).toArray();
  const revision = async () => (await f.db.collection("trips").findOne({ _id: f.trip }))!.destinationOrderRevision ?? 0;
  const keyFor = () => {
    const key = `trips/${f.trip}/photos/${f.actor}/${crypto.randomUUID()}.jpg`;
    fake.put(key, "image/jpeg");
    return key;
  };

  it("stores exactly the PRD fields with ObjectId and Date and the post publication time", async () => {
    const { post, expense: saved } = await created({ expense });
    const stored = await expenses();
    expect(stored).toHaveLength(1);
    expect(Object.keys(stored[0]!).sort()).toEqual(["_id", "breakdown", "createdAt", "currency", "postId", "totalAmount", "tripId"]);
    expect(stored[0]).toEqual({ _id: new ObjectId(saved!.id), postId: new ObjectId(post.id), tripId: f.trip, ...expense, createdAt: post.createdAt });
    expect(stored[0]!.createdAt).toBeInstanceOf(Date);
    expect(saved).toEqual({ id: saved!.id, postId: post.id, tripId: post.tripId, ...expense, createdAt: post.createdAt });
  });

  it("stores a missing breakdown as null and a blank one too", async () => {
    await created({ expense: { totalAmount: 10, currency: "USD" } });
    await created({ expense: { totalAmount: 10, currency: "EUR", breakdown: "   " } });
    expect((await expenses()).map((doc) => doc.breakdown)).toEqual([null, null]);
  });

  it("a second save for the same post updates the same record without duplicating it", async () => {
    const { post, expense: first } = await created({ expense });
    const second = await edited(post.id, { expense: { totalAmount: 20 } });
    expect(second.expense).toMatchObject({ id: first!.id, totalAmount: 20, currency: "ARS", breakdown: expense.breakdown, createdAt: post.createdAt });
    const stored = await expenses();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ _id: new ObjectId(first!.id), totalAmount: 20, currency: "ARS", breakdown: expense.breakdown, createdAt: post.createdAt });
  });

  it("inserts the expense of an existing post on PATCH, stamped with the edit time and not with the post time", async () => {
    const { post } = await created();
    const before = Date.now();
    const { expense: saved } = await edited(post.id, { expense });
    expect(saved!.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(saved!.createdAt.getTime()).toBeGreaterThanOrEqual(post.createdAt.getTime());
    expect((await f.db.collection("posts").findOne({ _id: new ObjectId(post.id) }))!.createdAt).toEqual(post.createdAt);
  });

  it("completes a legacy expense in place: one document, paidBy and createdAt intact, no payments, shares or invented breakdown", async () => {
    const { post } = await created(), paidBy = new ObjectId(), createdAt = new Date("2026-01-01T00:00:00.000Z");
    const legacy = { _id: new ObjectId(), tripId: f.trip, postId: new ObjectId(post.id), totalAmount: 100, paidBy, createdAt };
    await f.db.collection("postExpenses").insertOne(legacy);
    const { expense: saved } = await edited(post.id, { expense: { currency: "ARS" } });
    expect(saved).toMatchObject({ id: legacy._id.toHexString(), totalAmount: 100, currency: "ARS", breakdown: null });
    const stored = await expenses();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual({ ...legacy, currency: "ARS" });
    expect(stored[0]).not.toHaveProperty("payments"); expect(stored[0]).not.toHaveProperty("shares");
  });

  it("refuses to complete a legacy expense without a currency and leaves it as it was", async () => {
    const { post } = await created();
    await f.db.collection("postExpenses").insertOne({ tripId: f.trip, postId: new ObjectId(post.id), totalAmount: 100, paidBy: new ObjectId(), createdAt: new Date() });
    const before = await snapshot();
    expect(await updatePost(post.id, { description: "Editado", expense: { totalAmount: 120 } })).toMatchObject({ ok: false,
      error: { tag: "ValidationError", issues: [{ field: "expense.currency", code: "required" }] } });
    expect(await snapshot()).toEqual(before);
  });

  it.each([[{ totalAmount: 250 }], [{ breakdown: "otro" }], [{ currency: "EUR" }]])("keeps payments and shares already stored when %j changes", async (change) => {
    const { post } = await created({ expense });
    const payments = [{ userId: new ObjectId(), unit: "percent", value: 100 }], shares = [{ userId: new ObjectId(), unit: "remainder", value: null }];
    await f.db.collection("postExpenses").updateOne({ postId: new ObjectId(post.id) }, { $set: { payments, shares, paidBy: new ObjectId() } });
    const before = (await expenses())[0]!;
    await edited(post.id, { expense: change });
    expect((await expenses())[0]).toEqual({ ...before, ...change });
  });

  it("has the unique index: a manual duplicate for the same post fails with 11000", async () => {
    const { post } = await created({ expense });
    await expect(f.db.collection("postExpenses").insertOne({ tripId: f.trip, postId: new ObjectId(post.id), totalAmount: 1, currency: "ARS", breakdown: null, createdAt: new Date() }))
      .rejects.toMatchObject({ code: 11000 });
  });

  it("answers ExpenseConflictError when the unique index rejects the insert and rolls the whole save back", async () => {
    const { post } = await created();
    await f.db.collection("postExpenses").insertOne({ tripId: new ObjectId(), postId: new ObjectId(post.id), totalAmount: 1, currency: "ARS", breakdown: null, createdAt: new Date() });
    const before = await snapshot();
    expect(await updatePost(post.id, { description: "No se guarda", expense })).toMatchObject({ ok: false, error: { tag: "ExpenseConflictError" } });
    expect(await snapshot()).toEqual(before);
  });

  it("takes the Trip lock once per save with an expense", async () => {
    const start = await revision();
    const { post } = await created({ expense });
    expect(await revision()).toBe(start + 1);
    await edited(post.id, { expense: { totalAmount: 3 } });
    expect(await revision()).toBe(start + 2);
  });

  it("writes nothing when the agenda needs confirmation, and writes the expense with the confirmation", async () => {
    await created({ newActivity: scheduled("2026-09-25T12:00:00.000Z") });
    // The Trip lock (a revision bump on `trips`) commits even when nothing else is written, so only the data collections are compared.
    const withoutTrips = async () => (await snapshot()).slice(1);
    const before = await withoutTrips();
    const first = await createPost({ newActivity: scheduled("2026-09-25T12:30:00.000Z"), expense });
    expect(first).toMatchObject({ ok: true, value: { outcome: "confirmation_required" } });
    expect(await withoutTrips()).toEqual(before);
    expect(await expenses()).toEqual([]);
    if (!first.ok || first.value.outcome !== "confirmation_required") throw new Error("expected confirmation_required");
    const confirmation = { confirmedConflicts: first.value.conflicts.map((c) => ({ activityId: c.activityId, scheduledAt: c.scheduledAt, durationMinutes: c.durationMinutes })),
      confirmedActivity: first.value.activity };
    expect(await createPost({ newActivity: scheduled("2026-09-25T12:30:00.000Z"), expense, ...confirmation })).toMatchObject({ ok: true, value: { outcome: "created" } });
    expect(await expenses()).toHaveLength(1);
  });

  describe("atomicity", () => {
    const failOn = (name: string, method: "insertOne" | "updateOne") => {
      const collection = f.db.collection(name), original = f.db.collection.bind(f.db);
      const spy = vi.spyOn(collection, method).mockRejectedValueOnce(new Error("forced failure") as never);
      vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === name ? collection : original(key, options));
      return spy;
    };

    it.each(["insertOne"] as const)("creates no post, activity, participation, photo or expense when postExpenses.%s fails", async (method) => {
      const before = await snapshot(), photo = keyFor();
      const spy = failOn("postExpenses", method);
      expect(await createPost({ newActivity: scheduled("2026-09-25T12:00:00.000Z"), photos: [{ key: photo }], expense }))
        .toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(await snapshot()).toEqual(before);
    });

    it("keeps the previous post, photos and expense when postExpenses.updateOne fails on PATCH", async () => {
      const { post } = await created({ expense }), before = await snapshot(), photo = keyFor();
      const spy = failOn("postExpenses", "updateOne");
      expect(await updatePost(post.id, { description: "Editado", photos: [{ key: photo }], expense: { totalAmount: 9 } }))
        .toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(await snapshot()).toEqual(before);
    });

    it("rolls back activity, link, participation and expense when the expense insert fails while linking a post", async () => {
      const { post } = await created(), before = await snapshot();
      const spy = failOn("postExpenses", "insertOne");
      expect(await f.api.linkPostToNewActivity!({ ...f.context(), postId: domainId(new ObjectId(post.id)),
        newActivity: scheduled("2026-09-25T12:00:00.000Z"), expense })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(await snapshot()).toEqual(before);
    });

    it("writes no expense when posts.insertOne fails", async () => {
      const before = await snapshot();
      failOn("posts", "insertOne");
      expect(await createPost({ expense })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(await snapshot()).toEqual(before);
      expect(await expenses()).toEqual([]);
    });

    it("writes nothing when the expense is invalid, not even the post, activity or photos", async () => {
      const before = await snapshot(), photo = keyFor();
      expect(await createPost({ newActivity: scheduled("2026-09-25T12:00:00.000Z"), photos: [{ key: photo }], expense: { totalAmount: 0, currency: "ARS" } }))
        .toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "expense.totalAmount", code: "invalid" }] } });
      expect(await snapshot()).toEqual(before);
    });
  });

  // Deterministic ordering: the first call of `method` on `name` runs for real and then stays paused (its transaction
  // open, Trip lock already taken) until `release()`. The rival operation is started while the pause holds.
  const pauseAfterFirst = (name: string, method: "insertOne" | "updateOne" | "findOne") => {
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

  concurrent("makes an expulsion wait for an in-flight save with an expense, which keeps the former member's expense", async () => {
    const admin = await addMember("admin");
    const paused = pauseAfterFirst("postExpenses", "insertOne");
    const saving = launch(createPost({ expense }));
    let expelling!: ReturnType<typeof expel>;
    try {
      await paused.reached;
      expelling = launch(expel(admin)); const expulsion = track(expelling);
      await pause();
      expect(expulsion.settled, "expulsion finished while the expense save transaction was open").toBe(false);
    } finally { paused.release(); }
    const [saved, expelled] = await Promise.all([saving, expelling]);
    expect(saved.ok).toBe(true);
    expect(expelled.ok).toBe(true);
    expect(await expenses()).toMatchObject([{ tripId: f.trip, ...expense }]);
    expect(await f.db.collection("posts").countDocuments({ authorId: f.actor })).toBe(1);
    expect(await f.db.collection("tripMembers").countDocuments({ userId: f.actor })).toBe(0);
  });

  concurrent("makes an expense save wait for an in-flight expulsion and then fail with 404 without writing an expense", async () => {
    const admin = await addMember("admin");
    const paused = pauseAfterFirst("trips", "updateOne");
    const expelling = launch(expel(admin));
    let saving!: ReturnType<typeof createPost>;
    try {
      await paused.reached;
      saving = launch(createPost({ expense })); const save = track(saving);
      await pause();
      expect(save.settled, "expense save finished while the expulsion transaction was open").toBe(false);
    } finally { paused.release(); }
    const [expelled, saved] = await Promise.all([expelling, saving]);
    expect(expelled.ok).toBe(true);
    expect(saved).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(await expenses()).toEqual([]);
    expect(await f.db.collection("posts").countDocuments({})).toBe(0);
  });

  concurrent("makes Trip deletion wait for an in-flight save with an expense and then leaves no expenses", async () => {
    await f.db.collection("tripMembers").updateOne({ tripId: f.trip }, { $set: { role: "admin" } });
    const paused = pauseAfterFirst("postExpenses", "insertOne");
    const saving = launch(createPost({ expense }));
    let deleting!: ReturnType<typeof deleteTrip>;
    try {
      await paused.reached;
      deleting = launch(deleteTrip()); const deletion = track(deleting);
      await pause();
      expect(deletion.settled, "deletion finished while the expense save transaction was open").toBe(false);
    } finally { paused.release(); }
    const [saved, deleted] = await Promise.all([saving, deleting]);
    expect(saved.ok).toBe(true);
    expect(deleted.ok).toBe(true);
    expect(await expenses()).toEqual([]);
    expect(await f.db.collection("posts").countDocuments({})).toBe(0);
  });

  concurrent("serializes two concurrent PATCH of the same post and leaves a single merged document", async () => {
    const { post } = await created();
    const paused = pauseAfterFirst("postExpenses", "insertOne");
    const first = launch(updatePost(post.id, { expense: { totalAmount: 10, currency: "ARS" } }));
    let second!: ReturnType<typeof updatePost>;
    try {
      await paused.reached;
      second = launch(updatePost(post.id, { expense: { breakdown: "segunda" } })); const rival = track(second);
      await pause();
      expect(rival.settled, "second PATCH finished while the first transaction was open").toBe(false);
    } finally { paused.release(); }
    const [a, b] = await Promise.all([first, second]);
    expect(a.ok).toBe(true);
    expect(b.ok, JSON.stringify(b)).toBe(true);
    const stored = await expenses();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ totalAmount: 10, currency: "ARS", breakdown: "segunda" });
  });
});
