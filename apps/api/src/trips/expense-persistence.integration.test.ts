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
    expect(Object.keys(stored[0]!).sort()).toEqual(["_id", "breakdown", "createdAt", "currency", "payments", "postId", "shares", "totalAmount", "tripId"]);
    expect(stored[0]).toEqual({ _id: new ObjectId(saved!.id), postId: new ObjectId(post.id), tripId: f.trip, ...expense, payments: [], shares: [], createdAt: post.createdAt });
    expect(stored[0]!.createdAt).toBeInstanceOf(Date);
    expect(saved).toEqual({ id: saved!.id, postId: post.id, tripId: post.tripId, ...expense, payments: [], shares: [], createdAt: post.createdAt,
      completeness: { status: "incomplete", reasons: ["missing_payments", "missing_shares"] }, formerMemberIds: [] });
    expect(stored[0]).not.toHaveProperty("completeness");
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
    const failOn = (name: string, method: "insertOne" | "updateOne" | "findOneAndUpdate") => {
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

    // The author's participation is saved AFTER the expense in the same transaction: forcing it to fail proves the expense write
    // (insert or $set) joined the session and is rolled back. `expenseWrites` proves the expense write really ran first.
    const failAfterExpense = (expenseMethod: "insertOne" | "updateOne") => {
      const expenseCollection = f.db.collection("postExpenses"), participations = f.db.collection("activityParticipations");
      const original = f.db.collection.bind(f.db);
      const expenseWrites = vi.spyOn(expenseCollection, expenseMethod);
      const participationFailure = vi.spyOn(participations, "findOneAndUpdate").mockRejectedValueOnce(new Error("forced failure") as never);
      vi.spyOn(f.db, "collection").mockImplementation((key, options) =>
        key === "postExpenses" ? expenseCollection : key === "activityParticipations" ? participations : original(key, options));
      return { expenseWrites, participationFailure };
    };

    it("rolls back the expense insert when the author's participation fails after it on POST with a new activity", async () => {
      const before = await snapshot();
      const { expenseWrites, participationFailure } = failAfterExpense("insertOne");
      expect(await createPost({ newActivity: scheduled("2026-09-25T12:00:00.000Z"), expense }))
        .toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(expenseWrites).toHaveBeenCalledTimes(1);
      expect(participationFailure).toHaveBeenCalledTimes(1);
      expect(await snapshot()).toEqual(before);
      expect(await expenses()).toEqual([]);
    });

    it("rolls back the expense insert when the author's participation fails after it while linking a post to a new activity", async () => {
      const { post } = await created(), before = await snapshot();
      const { expenseWrites, participationFailure } = failAfterExpense("insertOne");
      expect(await f.api.linkPostToNewActivity!({ ...f.context(), postId: domainId(new ObjectId(post.id)),
        newActivity: scheduled("2026-09-25T12:00:00.000Z"), expense })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(expenseWrites).toHaveBeenCalledTimes(1);
      expect(participationFailure).toHaveBeenCalledTimes(1);
      expect(await snapshot()).toEqual(before);
      expect(await expenses()).toEqual([]);
    });

    it("rolls back the expense $set when the author's participation fails after it while linking a post with a stored expense", async () => {
      const { post } = await created({ expense }), before = await snapshot();
      const { expenseWrites, participationFailure } = failAfterExpense("updateOne");
      expect(await f.api.linkPostToNewActivity!({ ...f.context(), postId: domainId(new ObjectId(post.id)),
        newActivity: scheduled("2026-09-25T12:00:00.000Z"), expense: { totalAmount: 9, breakdown: "otro" } }))
        .toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(expenseWrites).toHaveBeenCalledTimes(1);
      expect(participationFailure).toHaveBeenCalledTimes(1);
      expect(await snapshot()).toEqual(before);
      expect((await expenses())[0]).toMatchObject(expense);
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

    // T80: rows that fail validation or membership must not leave the post, activity, participation, photos or expense behind.
    it("writes nothing when a new payment row names a non-member, not even the post, activity, participation or photos", async () => {
      const before = await snapshot(), photo = keyFor(), outsider = new ObjectId().toHexString();
      expect(await createPost({ newActivity: scheduled("2026-09-25T12:00:00.000Z"), photos: [{ key: photo }],
        expense: { ...expense, payments: [{ userId: outsider, unit: "percent", value: 100 }] } }))
        .toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "expense.payments[0].userId", code: "not_member" }] } });
      expect(await snapshot()).toEqual(before);
    });

    it("rolls back the payments and shares inserted with the expense when the author's participation fails AFTER them", async () => {
      const before = await snapshot();
      const { expenseWrites, participationFailure } = failAfterExpense("insertOne");
      const rows = { payments: [{ userId: f.actor.toHexString(), unit: "percent", value: 100 }], shares: [{ userId: f.actor.toHexString(), unit: "remainder", value: null }] };
      expect(await createPost({ newActivity: scheduled("2026-09-25T12:00:00.000Z"), expense: { ...expense, ...rows } }))
        .toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(expenseWrites).toHaveBeenCalledTimes(1);
      expect(participationFailure).toHaveBeenCalledTimes(1);
      expect(await snapshot()).toEqual(before);
      expect(await expenses()).toEqual([]);
    });

    it("keeps the stored payments and shares when their $set is rolled back because the author's participation fails AFTER it", async () => {
      const { post } = await created({ expense }), before = await snapshot();
      const { expenseWrites, participationFailure } = failAfterExpense("updateOne");
      const rows = { payments: [{ userId: f.actor.toHexString(), unit: "percent", value: 100 }], shares: [{ userId: f.actor.toHexString(), unit: "remainder", value: null }] };
      expect(await f.api.linkPostToNewActivity!({ ...f.context(), postId: domainId(new ObjectId(post.id)),
        newActivity: scheduled("2026-09-25T12:00:00.000Z"), expense: rows })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(expenseWrites).toHaveBeenCalledTimes(1);
      expect(participationFailure).toHaveBeenCalledTimes(1);
      expect(await snapshot()).toEqual(before);
      expect((await expenses())[0]).toMatchObject({ payments: [], shares: [] });
    });
  });

  describe("payments and shares (T80)", () => {
    const hex = (id: ObjectId) => id.toHexString();
    const spyOnExpenseWrites = () => {
      const collection = f.db.collection("postExpenses"), original = f.db.collection.bind(f.db);
      const updates = vi.spyOn(collection, "updateOne"), inserts = vi.spyOn(collection, "insertOne");
      vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === "postExpenses" ? collection : original(key, options));
      return { updates, inserts };
    };
    const agreement = async () => {
      const [ana, beto, caro, dani] = [await addMember("participant"), await addMember("participant"), await addMember("participant"), await addMember("participant")];
      return { ana, beto, caro, dani, rows: {
        payments: [{ userId: hex(ana), unit: "amount", value: 400 }, { userId: hex(ana), unit: "amount", value: 100 }, { userId: hex(beto), unit: "percent", value: 50 }],
        shares: [{ userId: hex(ana), unit: "amount", value: 100 }, { userId: hex(beto), unit: "percent", value: 20 }, { userId: hex(caro), unit: "remainder", value: null },
          { userId: hex(dani), unit: "excluded", value: null }] } };
    };

    it("stores several payments and every share unit as ObjectId rows and answers the same rows with a complete agreement", async () => {
      const { ana, beto, caro, dani, rows } = await agreement();
      const { expense: saved } = await created({ expense: { totalAmount: 1000, currency: "ARS", ...rows } });
      expect(await expenses()).toMatchObject([{ payments: [{ userId: ana, unit: "amount", value: 400 }, { userId: ana, unit: "amount", value: 100 },
        { userId: beto, unit: "percent", value: 50 }], shares: [{ userId: ana, unit: "amount", value: 100 }, { userId: beto, unit: "percent", value: 20 },
        { userId: caro, unit: "remainder", value: null }, { userId: dani, unit: "excluded", value: null }] }]);
      const stored = (await expenses())[0]!;
      for (const row of [...stored.payments, ...stored.shares]) expect(row.userId).toBeInstanceOf(ObjectId);
      expect(saved).toMatchObject({ payments: rows.payments, shares: rows.shares, completeness: { status: "complete", reasons: [] }, formerMemberIds: [] });
      expect(stored).not.toHaveProperty("completeness");
    });

    it("saves an incomplete agreement and names what is missing, rejecting only the invalid or the excess", async () => {
      const { ana } = await agreement();
      const { post } = await created();
      const { expense: saved } = await edited(post.id, { expense: { ...expense, payments: [{ userId: hex(ana), unit: "amount", value: 10 }] } });
      expect(saved).toMatchObject({ completeness: { status: "incomplete", reasons: ["payments_not_covering_total", "missing_shares"] } });
      const before = await snapshot();
      expect(await updatePost(post.id, { expense: { payments: [{ userId: hex(ana), unit: "amount", value: 99999 }] } }))
        .toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "expense.payments", code: "exceeds_total" }] } });
      expect(await snapshot()).toEqual(before);
    });

    it("$set of one list keeps the other list, paidBy and createdAt, and writes no shares nobody sent", async () => {
      const { ana, beto } = await agreement();
      const { post } = await created({ expense: { ...expense, payments: [{ userId: hex(ana), unit: "percent", value: 100 }],
        shares: [{ userId: hex(beto), unit: "remainder", value: null }] } });
      const paidBy = new ObjectId();
      await f.db.collection("postExpenses").updateOne({ postId: new ObjectId(post.id) }, { $set: { paidBy } });
      const before = (await expenses())[0]!;
      const writes = spyOnExpenseWrites();
      await edited(post.id, { expense: { payments: [{ userId: hex(beto), unit: "percent", value: 100 }] } });
      expect(writes.updates).toHaveBeenCalledTimes(1);
      expect(writes.updates.mock.calls[0]![1]).toEqual({ $set: { payments: [{ userId: beto, unit: "percent", value: 100 }] } });
      expect((await expenses())[0]).toEqual({ ...before, payments: [{ userId: beto, unit: "percent", value: 100 }] });
      expect((await expenses())[0]).toMatchObject({ paidBy, createdAt: before.createdAt, shares: before.shares });
    });

    it("an expense without shares writes empty lists on insert and never proposes a payer or a split", async () => {
      await agreement();
      const writes = spyOnExpenseWrites();
      const { expense: saved } = await created({ expense });
      expect(writes.inserts.mock.calls[0]![0]).toMatchObject({ payments: [], shares: [] });
      expect(saved).toMatchObject({ payments: [], shares: [], completeness: { status: "incomplete" } });
      expect(await expenses()).toMatchObject([{ payments: [], shares: [] }]);
    });

    it("null and non-list payments answer 422 and an explicit empty list clears the stored one", async () => {
      const { ana } = await agreement();
      const { post } = await created({ expense: { ...expense, payments: [{ userId: hex(ana), unit: "percent", value: 100 }] } });
      const before = await snapshot();
      for (const bad of [null, "x", {}]) {
        expect(await updatePost(post.id, { expense: { payments: bad } })).toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "expense.payments", code: "invalid" }] } });
      }
      expect(await snapshot()).toEqual(before);
      expect((await edited(post.id, { expense: { payments: [] } })).expense).toMatchObject({ payments: [] });
      expect(await expenses()).toMatchObject([{ payments: [] }]);
    });

    it.each([["register", "balance"], ["balance", "register"]] as const)("a Trip changing from %s to %s keeps and accepts payments and shares", async (from, to) => {
      const { ana, beto, rows } = await agreement();
      await f.db.collection("trips").updateOne({ _id: f.trip }, { $set: { expenseMode: from } });
      const { post } = await created({ expense: { totalAmount: 1000, currency: "ARS", ...rows } });
      await f.db.collection("trips").updateOne({ _id: f.trip }, { $set: { expenseMode: to } });
      const stored = (await expenses())[0]!;
      expect(stored.payments).toHaveLength(3); expect(stored.shares).toHaveLength(4);
      const after = await edited(post.id, { expense: { shares: [{ userId: hex(ana), unit: "remainder", value: null }, { userId: hex(beto), unit: "excluded", value: null }] } });
      expect(after.expense).toMatchObject({ payments: rows.payments });
      await f.db.collection("trips").updateOne({ _id: f.trip }, { $set: { expenseMode: from } });
      expect((await expenses())[0]!.payments).toEqual(stored.payments);
    });

    it("a total change keeps fixed amounts as amounts and percentages as percentages; an excess answers 422 until rows are resent", async () => {
      const { ana, beto } = await agreement();
      const { post } = await created({ expense: { totalAmount: 1000, currency: "ARS", payments: [{ userId: hex(ana), unit: "amount", value: 400 },
        { userId: hex(beto), unit: "percent", value: 60 }] } });
      await edited(post.id, { expense: { totalAmount: 2000 } });
      expect((await expenses())[0]).toMatchObject({ totalAmount: 2000, payments: [{ userId: ana, unit: "amount", value: 400 }, { userId: beto, unit: "percent", value: 60 }] });
      const before = await snapshot();
      expect(await updatePost(post.id, { expense: { totalAmount: 300 } })).toMatchObject({ ok: false,
        error: { tag: "ValidationError", issues: [{ field: "expense.payments", code: "exceeds_total" }] } });
      expect(await snapshot()).toEqual(before);
      expect(await updatePost(post.id, { expense: { totalAmount: 300, payments: [{ userId: hex(ana), unit: "amount", value: 100 }] } })).toMatchObject({ ok: true });
    });

    describe("former members", () => {
      const formerMember = async (how: "expelled" | "left") => {
        const { ana, beto } = await agreement();
        const { post } = await created({ expense: { totalAmount: 100, currency: "ARS", payments: [{ userId: hex(ana), unit: "percent", value: 100 }],
          shares: [{ userId: hex(ana), unit: "amount", value: 30 }, { userId: hex(beto), unit: "remainder", value: null }] } });
        if (how === "expelled") {
          const admin = await addMember("admin");
          const expelled = await f.api.expelMember!({ tripId: domainId(f.trip), actorUserId: domainId(admin), targetUserId: domainId(ana) });
          expect(expelled.ok).toBe(true);
        } else await f.db.collection("tripMembers").deleteOne({ tripId: f.trip, userId: ana });
        expect(await f.db.collection("tripMembers").countDocuments({ tripId: f.trip, userId: ana })).toBe(0);
        return { ana, beto, post };
      };

      it.each(["expelled", "left"] as const)("keeps the payment and share of a user who %s, lists them as a former member and keeps the expense readable", async (how) => {
        const { ana, post } = await formerMember(how);
        const { expense: saved } = await edited(post.id, { expense: { breakdown: "cena" } });
        expect(saved).toMatchObject({ breakdown: "cena", formerMemberIds: [hex(ana)], payments: [{ userId: hex(ana), unit: "percent", value: 100 }],
          shares: [{ userId: hex(ana), unit: "amount", value: 30 }, { unit: "remainder" }], completeness: { status: "complete", reasons: [] } });
        expect((await expenses())[0]).toMatchObject({ payments: [{ userId: ana }], shares: [{ userId: ana, value: 30 }, {}] });
      });

      it("accepts resending the rows of the former member as returned, and lets the group redistribute without them; a NEW row of theirs is refused", async () => {
        const { ana, beto, post } = await formerMember("expelled");
        const resent = (await edited(post.id, { expense: { totalAmount: 100 } })).expense!;
        expect(await updatePost(post.id, { expense: { payments: resent.payments, shares: resent.shares } })).toMatchObject({ ok: true });
        const before = await snapshot();
        expect(await updatePost(post.id, { expense: { shares: [{ userId: hex(beto), unit: "remainder", value: null }, { userId: hex(new ObjectId()), unit: "excluded", value: null }] } }))
          .toMatchObject({ ok: false, error: { issues: [{ field: "expense.shares[1].userId", code: "not_member" }] } });
        expect(await snapshot()).toEqual(before);
        const redistributed = await edited(post.id, { expense: { payments: [{ userId: hex(beto), unit: "percent", value: 100 }], shares: [{ userId: hex(beto), unit: "remainder", value: null }] } });
        expect(redistributed.expense).toMatchObject({ formerMemberIds: [], completeness: { status: "complete" } });
        expect(JSON.stringify(await expenses())).not.toContain(hex(ana));
      });

      it("a member who joins later does not change the stored agreements and a new row for them is an explicit edit", async () => {
        const { ana, post } = await formerMember("left");
        const before = (await expenses())[0]!;
        const newcomer = await addMember("participant");
        expect((await expenses())[0]).toEqual(before);
        const { expense: saved } = await edited(post.id, { expense: { breakdown: "x" } });
        expect(saved).toMatchObject({ payments: [{ userId: hex(ana) }], formerMemberIds: [hex(ana)] });
        expect((await expenses())[0]).toEqual({ ...before, breakdown: "x" });
        const included = await edited(post.id, { expense: { shares: [{ userId: hex(newcomer), unit: "remainder", value: null }, { userId: hex(ana), unit: "amount", value: 30 }] } });
        expect(included.expense).toMatchObject({ shares: [{ userId: hex(newcomer) }, { userId: hex(ana) }] });
      });
    });

    describe("legacy paidBy", () => {
      const legacyDocument = async (post: { id: string }, fields: object = {}) => {
        const paidBy = new ObjectId(), legacy = { _id: new ObjectId(), tripId: f.trip, postId: new ObjectId(post.id), totalAmount: 100, paidBy,
          createdAt: new Date("2026-01-01T00:00:00.000Z"), ...fields };
        await f.db.collection("postExpenses").insertOne(legacy);
        return legacy;
      };

      it("reads the legacy payer as a payment of 100 percent without writing anything, incomplete and with the payer as former member", async () => {
        const { post } = await created();
        const legacy = await legacyDocument(post);
        const writes = spyOnExpenseWrites();
        const { expense: saved } = await edited(post.id, { expense: { currency: "ARS" } });
        expect(saved).toMatchObject({ currency: "ARS", payments: [{ userId: hex(legacy.paidBy), unit: "percent", value: 100 }], shares: [],
          formerMemberIds: [hex(legacy.paidBy)], completeness: { status: "incomplete", reasons: ["missing_shares"] } });
        expect(writes.updates.mock.calls[0]![1]).toEqual({ $set: { currency: "ARS" } });
        expect((await expenses())[0]).toEqual({ ...legacy, currency: "ARS" });
      });

      it("an explicit empty payments list is not adapted again from paidBy, nor does a later save resurrect it", async () => {
        const { post } = await created();
        const legacy = await legacyDocument(post, { currency: "ARS" });
        expect((await edited(post.id, { expense: { payments: [] } })).expense).toMatchObject({ payments: [] });
        expect((await expenses())[0]).toMatchObject({ paidBy: legacy.paidBy, payments: [] });
        expect((await edited(post.id, { expense: { breakdown: "otra vez" } })).expense).toMatchObject({ payments: [], formerMemberIds: [] });
        expect((await expenses())[0]).toMatchObject({ payments: [] });
      });

      it("a null or absent paidBy gives no payment and a stored payments list wins over paidBy", async () => {
        const { post } = await created();
        const legacy = await legacyDocument(post, { paidBy: null, currency: "ARS" });
        expect((await edited(post.id, { expense: { breakdown: "x" } })).expense).toMatchObject({ payments: [], completeness: { reasons: ["missing_payments", "missing_shares"] } });
        const ana = await addMember("participant");
        await f.db.collection("postExpenses").updateOne({ _id: legacy._id }, { $set: { paidBy: new ObjectId(), payments: [{ userId: ana, unit: "amount", value: 100 }] } });
        expect((await edited(post.id, { expense: { breakdown: "y" } })).expense).toMatchObject({ payments: [{ userId: hex(ana), unit: "amount", value: 100 }], formerMemberIds: [] });
      });
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

  // T80: the membership of the referenced users is read under the same Trip lock as the save, so an expulsion and a save are serialized.
  const expelUser = (admin: ObjectId, target: ObjectId) => f.api.expelMember!({ tripId: domainId(f.trip), actorUserId: domainId(admin), targetUserId: domainId(target) });

  concurrent("an expulsion that wins the lock makes a save that names the expelled user as a NEW row fail with not_member, writing nothing", async () => {
    const admin = await addMember("admin"), target = await addMember("participant");
    const paused = pauseAfterFirst("trips", "updateOne");
    const expelling = launch(expelUser(admin, target));
    let saving!: ReturnType<typeof createPost>;
    try {
      await paused.reached;
      saving = launch(createPost({ expense: { ...expense, payments: [{ userId: target.toHexString(), unit: "percent", value: 100 }] } })); const save = track(saving);
      await pause();
      expect(save.settled, "save finished while the expulsion transaction was open").toBe(false);
    } finally { paused.release(); }
    const [expelled, saved] = await Promise.all([expelling, saving]);
    expect(expelled.ok).toBe(true);
    expect(saved).toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "expense.payments[0].userId", code: "not_member" }] } });
    expect(await expenses()).toEqual([]);
    expect(await f.db.collection("posts").countDocuments({})).toBe(0);
    expect(await f.db.collection("tripMembers").countDocuments({ userId: target })).toBe(0);
  });

  concurrent("a save that wins the lock keeps the row of the user, and the expulsion that follows makes them a former member", async () => {
    const admin = await addMember("admin"), target = await addMember("participant");
    const paused = pauseAfterFirst("postExpenses", "insertOne");
    const saving = launch(createPost({ expense: { ...expense, payments: [{ userId: target.toHexString(), unit: "percent", value: 100 }] } }));
    let expelling!: ReturnType<typeof expelUser>;
    try {
      await paused.reached;
      expelling = launch(expelUser(admin, target)); const expulsion = track(expelling);
      await pause();
      expect(expulsion.settled, "expulsion finished while the save transaction was open").toBe(false);
    } finally { paused.release(); }
    const [saved, expelled] = await Promise.all([saving, expelling]);
    expect(saved.ok).toBe(true);
    expect(expelled.ok).toBe(true);
    expect(await expenses()).toMatchObject([{ payments: [{ userId: target, unit: "percent", value: 100 }] }]);
    if (!saved.ok || saved.value.outcome !== "created") throw new Error("expected created");
    expect(saved.value.expense).toMatchObject({ formerMemberIds: [] });
    const later = await edited(saved.value.post.id, { expense: { breakdown: "despues" } });
    expect(later.expense).toMatchObject({ formerMemberIds: [target.toHexString()], payments: [{ userId: target.toHexString() }] });
  });

  concurrent("serializes two concurrent PATCH of payments and shares: both lists survive and none is lost", async () => {
    const ana = await addMember("participant");
    const { post } = await created({ expense });
    const paused = pauseAfterFirst("postExpenses", "updateOne");
    const first = launch(updatePost(post.id, { expense: { payments: [{ userId: ana.toHexString(), unit: "percent", value: 100 }] } }));
    let second!: ReturnType<typeof updatePost>;
    try {
      await paused.reached;
      second = launch(updatePost(post.id, { expense: { shares: [{ userId: ana.toHexString(), unit: "remainder", value: null }] } })); const rival = track(second);
      await pause();
      expect(rival.settled, "second PATCH finished while the first transaction was open").toBe(false);
    } finally { paused.release(); }
    const [a, b] = await Promise.all([first, second]);
    expect(a.ok).toBe(true);
    expect(b.ok, JSON.stringify(b)).toBe(true);
    expect(await expenses()).toMatchObject([{ payments: [{ userId: ana, unit: "percent", value: 100 }], shares: [{ userId: ana, unit: "remainder", value: null }] }]);
    if (b.ok) expect(b.value.expense).toMatchObject({ completeness: { status: "complete", reasons: [] } });
  });
});
