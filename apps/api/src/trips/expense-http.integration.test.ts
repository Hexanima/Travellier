import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { PostFixture } from "../../test/post-fixture.js";
import { FakeObjectStorage } from "../../test/fake-object-storage.js";

describe("post expense HTTP API (T79)", () => {
  const f = new PostFixture();
  let fake: FakeObjectStorage;
  beforeAll(() => f.start("expense_http"), 120_000);
  afterAll(() => f.stop());
  beforeEach(async () => { vi.restoreAllMocks(); fake = new FakeObjectStorage(); f.storage = fake; await f.reset(); });

  const body = (response: { body?: string }) => JSON.parse(response.body ?? "null");
  /** `[status, error code]` that never throws on a success body, so a failing assertion names the real status. */
  const outcome = (response: { statusCode: number; body?: string }) => [response.statusCode, body(response)?.error?.code];
  const fields = (response: { body?: string }) => body(response).error.fields.map((issue: { field: string; code: string }) => `${issue.field}/${issue.code}`);
  const expense = { totalAmount: 1500.5, currency: "ARS", breakdown: "agua 500, entrada 1000" };
  const view = ["breakdown", "completeness", "createdAt", "currency", "formerMemberIds", "id", "payments", "postId", "shares", "totalAmount", "tripId"];
  const bare = { payments: [], shares: [], completeness: { status: "incomplete", reasons: ["missing_payments", "missing_shares"] }, formerMemberIds: [] };
  const member = async () => {
    const userId = new ObjectId();
    await f.db.collection("tripMembers").insertOne({ tripId: f.trip, userId, role: "participant", joinedAt: new Date() });
    return userId.toHexString();
  };
  const newActivity = { title: "Cena", scheduledAt: "2026-09-25T12:00:00.456Z", durationMinutes: 60 };
  const seedPost = async () => {
    const response = await f.request("POST", f.path(), { description: "Recuerdo" });
    expect(response.statusCode, response.body).toBe(201);
    return body(response).post as { id: string; createdAt: string };
  };
  const expenses = () => f.db.collection("postExpenses").find().sort({ _id: 1 }).toArray();
  const uploaded = async () => {
    const response = await f.request("POST", `/trips/${f.trip}/photo-uploads`, { files: [{ contentType: "image/jpeg", sizeBytes: 1000 }] });
    expect(response.statusCode, response.body).toBe(201);
    const [upload] = body(response).uploads as { key: string }[];
    fake.put(upload!.key);
    return upload!.key;
  };

  describe("POST /trips/:tripId/posts", () => {
    it("answers 201 with the expense view and stores it with the post publication time", async () => {
      const response = await f.request("POST", f.path(), { description: "Cena", expense });
      expect(response.statusCode, response.body).toBe(201);
      const created = body(response);
      expect(Object.keys(created).sort()).toEqual(["expense", "post"]);
      expect(Object.keys(created.expense).sort()).toEqual(view);
      expect(created.expense).toEqual({ id: created.expense.id, postId: created.post.id, tripId: f.trip.toHexString(), ...expense, ...bare, createdAt: created.post.createdAt });
      const [stored] = await expenses();
      expect(stored).toMatchObject({ _id: new ObjectId(created.expense.id), postId: new ObjectId(created.post.id), tripId: f.trip, ...expense });
      expect(stored!.createdAt).toBeInstanceOf(Date);
    });

    it("answers exactly as before when no expense is sent", async () => {
      const response = await f.request("POST", f.path(), { description: "Sin gasto" });
      expect(response.statusCode).toBe(201);
      expect(Object.keys(body(response))).toEqual(["post"]);
      expect(await expenses()).toEqual([]);
    });

    it("saves the expense together with a new activity", async () => {
      const response = await f.request("POST", f.path(), { description: "Cena", newActivity, expense });
      expect(response.statusCode, response.body).toBe(201);
      expect(Object.keys(body(response)).sort()).toEqual(["activity", "expense", "participation", "post"]);
      expect(await expenses()).toHaveLength(1);
    });

    it("saves the expense together with photos", async () => {
      const key = await uploaded();
      const response = await f.request("POST", f.path(), { description: "Fotos", photos: [{ key }], expense });
      expect(response.statusCode, response.body).toBe(201);
      expect(Object.keys(body(response)).sort()).toEqual(["expense", "photos", "post"]);
      expect(await f.db.collection("postPhotos").countDocuments({})).toBe(1);
      expect(await expenses()).toHaveLength(1);
    });

    it.each([
      ["a non-positive total", { totalAmount: 0, currency: "ARS" }, ["expense.totalAmount/invalid"]],
      ["more than two decimals", { totalAmount: 10.005, currency: "ARS" }, ["expense.totalAmount/invalid"]],
      ["a missing currency", { totalAmount: 10 }, ["expense.currency/required"]],
      ["a missing total", { currency: "USD" }, ["expense.totalAmount/required"]],
      ["a currency outside the catalog", { totalAmount: 10, currency: "BRL" }, ["expense.currency/invalid"]],
      ["null payments", { totalAmount: 10, currency: "ARS", payments: null }, ["expense.payments/invalid"]],
      ["a non-list shares", { totalAmount: 10, currency: "ARS", shares: {} }, ["expense.shares/invalid"]],
      ["a derived completeness", { totalAmount: 10, currency: "ARS", completeness: { status: "complete" } }, ["expense.completeness/unsupported"]],
      ["paidBy", { totalAmount: 10, currency: "ARS", paidBy: new ObjectId().toHexString() }, ["expense.paidBy/unsupported"]],
      ["a non-text breakdown", { totalAmount: 10, currency: "ARS", breakdown: 5 }, ["expense.breakdown/invalid"]],
    ])("answers 422 with the failing fields for %s and writes nothing", async (_, bad, expected) => {
      const response = await f.request("POST", f.path(), { description: "Cena", expense: bad });
      expect(outcome(response)).toEqual([422, "ValidationError"]);
      expect(fields(response)).toEqual(expected);
      expect(await f.db.collection("posts").countDocuments({})).toBe(0);
      expect(await expenses()).toEqual([]);
    });

    it.each([["null", null], ["a list", [{ totalAmount: 1 }]], ["text", "100"], ["an empty object", {}]])("answers 422 expense/invalid for %s", async (_, bad) => {
      const response = await f.request("POST", f.path(), { description: "Cena", expense: bad });
      expect(outcome(response)).toEqual([422, "ValidationError"]);
      expect(fields(response)).toEqual(["expense/invalid"]);
      expect(await f.db.collection("posts").countDocuments({})).toBe(0);
    });

    it("answers 404 to a user that is not a member and writes nothing", async () => {
      const response = await f.request("POST", f.path(), { description: "Cena", expense }, new ObjectId());
      expect(outcome(response)).toEqual([404, "TripNotFoundError"]);
      expect(await expenses()).toEqual([]);
    });
  });

  describe("PATCH /trips/:tripId/posts/:postId", () => {
    it("answers 200 with only the expense and leaves the post untouched", async () => {
      const post = await seedPost();
      const response = await f.request("PATCH", `${f.path()}/${post.id}`, { expense });
      expect(response.statusCode, response.body).toBe(200);
      expect(Object.keys(body(response)).sort()).toEqual(["expense", "post"]);
      expect(body(response).post).toEqual(post);
      expect(Object.keys(body(response).expense).sort()).toEqual(view);
      expect(body(response).expense).toMatchObject({ postId: post.id, tripId: f.trip.toHexString(), ...expense });
      expect(await expenses()).toHaveLength(1);
    });

    it("answers exactly as before when no expense is sent", async () => {
      const post = await seedPost();
      const response = await f.request("PATCH", `${f.path()}/${post.id}`, { description: "Editado" });
      expect(response.statusCode).toBe(200);
      expect(Object.keys(body(response))).toEqual(["post"]);
    });

    it("merges a partial update, clears the breakdown with null and keeps a single document", async () => {
      const post = await seedPost(), url = `${f.path()}/${post.id}`;
      const first = body(await f.request("PATCH", url, { expense })).expense;
      const second = await f.request("PATCH", url, { expense: { totalAmount: 99 } });
      expect(second.statusCode, second.body).toBe(200);
      expect(body(second).expense).toEqual({ ...first, totalAmount: 99 });
      const cleared = await f.request("PATCH", url, { expense: { breakdown: null } });
      expect(body(cleared).expense).toEqual({ ...first, totalAmount: 99, breakdown: null });
      expect(await expenses()).toHaveLength(1);
    });

    it("completes a legacy expense exposing the payer as a payment of 100 percent (never paidBy) without inventing a currency or shares", async () => {
      const post = await seedPost(), paidBy = new ObjectId();
      const createdAt = new Date("2026-01-01T00:00:00.000Z");
      await f.db.collection("postExpenses").insertOne({ tripId: f.trip, postId: new ObjectId(post.id), totalAmount: 100, paidBy, createdAt });
      const rejected = await f.request("PATCH", `${f.path()}/${post.id}`, { expense: { breakdown: "x" } });
      expect(outcome(rejected)).toEqual([422, "ValidationError"]);
      expect(fields(rejected)).toEqual(["expense.currency/required"]);
      const response = await f.request("PATCH", `${f.path()}/${post.id}`, { expense: { currency: "ARS" } });
      expect(response.statusCode, response.body).toBe(200);
      expect(body(response).expense).toMatchObject({ totalAmount: 100, currency: "ARS", breakdown: null, createdAt: createdAt.toISOString() });
      expect(Object.keys(body(response).expense).sort()).toEqual(view);
      expect(body(response).expense).toMatchObject({ payments: [{ userId: paidBy.toHexString(), unit: "percent", value: 100 }], shares: [],
        formerMemberIds: [paidBy.toHexString()], completeness: { status: "incomplete", reasons: ["missing_shares"] } });
      expect(body(response).expense).not.toHaveProperty("paidBy");
      const stored = await expenses();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ paidBy, createdAt, currency: "ARS", totalAmount: 100 });
      expect(stored[0]).not.toHaveProperty("payments"); expect(stored[0]).not.toHaveProperty("shares");
    });

    it("saves the expense while linking the post to a new activity", async () => {
      const post = await seedPost();
      const response = await f.request("PATCH", `${f.path()}/${post.id}`, { newActivity, expense });
      expect(response.statusCode, response.body).toBe(200);
      expect(Object.keys(body(response)).sort()).toEqual(["activity", "expense", "participation", "post"]);
      expect(await expenses()).toHaveLength(1);
    });

    it("saves the expense together with photos and post fields", async () => {
      const post = await seedPost(), key = await uploaded();
      const response = await f.request("PATCH", `${f.path()}/${post.id}`, { description: "Editado", photos: [{ key }], expense });
      expect(response.statusCode, response.body).toBe(200);
      expect(Object.keys(body(response)).sort()).toEqual(["expense", "photos", "post"]);
      expect(body(response).post.description).toBe("Editado");
    });

    it("answers 422 for an invalid expense and keeps the stored expense", async () => {
      const post = await seedPost(), url = `${f.path()}/${post.id}`;
      await f.request("PATCH", url, { expense });
      for (const [bad, expected] of [[{ totalAmount: -1 }, ["expense.totalAmount/invalid"]], [{ payments: null }, ["expense.payments/invalid"]],
        [{ currency: "BRL", shares: null }, ["expense.currency/invalid", "expense.shares/invalid"]], [{ paidBy: new ObjectId().toHexString() }, ["expense.paidBy/unsupported"]], [null, ["expense/invalid"]],
        [[], ["expense/invalid"]], ["x", ["expense/invalid"]], [{}, ["expense/invalid"]]] as const) {
        const response = await f.request("PATCH", url, { description: "No se guarda", expense: bad });
        expect(outcome(response), response.body).toEqual([422, "ValidationError"]);
        expect(fields(response).sort()).toEqual([...expected].sort());
      }
      expect((await expenses())[0]).toMatchObject(expense);
      expect((await f.db.collection("posts").findOne({ _id: new ObjectId(post.id) }))!.description).toBe("Recuerdo");
    });

    it("answers 404 for a missing post and for a non-member", async () => {
      const post = await seedPost();
      expect(outcome(await f.request("PATCH", `${f.path()}/${new ObjectId()}`, { expense }))).toEqual([404, "PostNotFoundError"]);
      expect(outcome(await f.request("PATCH", `${f.path()}/${post.id}`, { expense }, new ObjectId()))).toEqual([404, "TripNotFoundError"]);
      expect(await expenses()).toEqual([]);
    });

    it("answers 409 ExpenseConflictError when another expense already owns the postId and rolls the edit back", async () => {
      const post = await seedPost();
      // An expense stored under another Trip with the same postId hides from this Trip's lookup but still hits the unique index.
      await f.db.collection("postExpenses").insertOne({ tripId: new ObjectId(), postId: new ObjectId(post.id), totalAmount: 1, currency: "ARS", breakdown: null, createdAt: new Date() });
      const response = await f.request("PATCH", `${f.path()}/${post.id}`, { description: "No se guarda", expense });
      expect(outcome(response)).toEqual([409, "ExpenseConflictError"]);
      expect((await f.db.collection("posts").findOne({ _id: new ObjectId(post.id) }))!.description).toBe("Recuerdo");
      expect(await expenses()).toHaveLength(1);
    });
  });

  describe("payments and shares (T80)", () => {
    const row = (userId: string, unit: string, value: number | null = null) => ({ userId, unit, value });

    it("POST answers 201 with the persisted rows, a complete agreement and the derived fields, not persisting them", async () => {
      const [ana, beto] = [await member(), await member()];
      const payments = [row(ana, "amount", 500), row(beto, "percent", 50)];
      const shares = [row(ana, "percent", 30), row(beto, "remainder")];
      const response = await f.request("POST", f.path(), { description: "Cena", expense: { totalAmount: 1000, currency: "USD", payments, shares } });
      expect(response.statusCode, response.body).toBe(201);
      const saved = body(response).expense;
      expect(Object.keys(saved).sort()).toEqual(view);
      expect(saved).toMatchObject({ payments, shares, completeness: { status: "complete", reasons: [] }, formerMemberIds: [] });
      const [stored] = await expenses();
      expect(stored).toMatchObject({ payments: [{ userId: new ObjectId(ana), unit: "amount", value: 500 }, { userId: new ObjectId(beto), unit: "percent", value: 50 }],
        shares: [{ userId: new ObjectId(ana), unit: "percent", value: 30 }, { userId: new ObjectId(beto), unit: "remainder", value: null }] });
      expect(stored).not.toHaveProperty("completeness"); expect(stored).not.toHaveProperty("formerMemberIds");
    });

    it("PATCH saves an incomplete agreement with the reasons, and the rows it answers can be resent as they came", async () => {
      const post = await seedPost(), url = `${f.path()}/${post.id}`, ana = await member();
      const response = await f.request("PATCH", url, { expense: { ...expense, payments: [row(ana, "amount", 10)] } });
      expect(response.statusCode, response.body).toBe(200);
      expect(body(response).expense).toMatchObject({ payments: [row(ana, "amount", 10)], shares: [],
        completeness: { status: "incomplete", reasons: ["payments_not_covering_total", "missing_shares"] }, formerMemberIds: [] });
      const { payments, shares } = body(response).expense;
      const again = await f.request("PATCH", url, { expense: { payments, shares } });
      expect(again.statusCode, again.body).toBe(200);
      expect(body(again).expense).toEqual(body(response).expense);
    });

    it.each([
      ["a negative payment value", { payments: [row("<ana>", "amount", -1)] }, ["expense.payments[0].value/invalid_value"]],
      ["a user repeated in shares", { shares: [row("<ana>", "remainder"), row("<beto>", "amount", 1), row("<beto>", "excluded")] }, ["expense.shares[2].userId/duplicate_user"]],
      ["an invalid unit", { payments: [row("<ana>", "remainder")] }, ["expense.payments[0].unit/invalid_unit"]],
      ["an invalid user id", { shares: [row("zz", "excluded")] }, ["expense.shares[0].userId/invalid_user"]],
      ["payments above the total", { payments: [row("<ana>", "amount", 900), row("<beto>", "amount", 900)] }, ["expense.payments/exceeds_total"]],
      ["shares above the total", { shares: [row("<ana>", "amount", 2000)] }, ["expense.shares/exceeds_total"]],
      ["a user that is not a member", { shares: [row("<ana>", "remainder"), row("<other>", "excluded")] }, ["expense.shares[1].userId/not_member"]],
      ["an unknown row key", { payments: [{ ...row("<ana>", "percent", 100), paidBy: "x" }] }, ["expense.payments[0].paidBy/unsupported"]],
    ])("answers 422 with the field and code of the row for %s and writes nothing", async (_, rows, expected) => {
      const [ana, beto, other] = [await member(), await member(), new ObjectId().toHexString()];
      const swap = (value: unknown) => JSON.parse(JSON.stringify(value).replaceAll("<ana>", ana).replaceAll("<beto>", beto).replaceAll("<other>", other));
      const response = await f.request("POST", f.path(), { description: "Cena", expense: { totalAmount: 1000, currency: "ARS", ...swap(rows) } });
      expect(outcome(response)).toEqual([422, "ValidationError"]);
      expect(fields(response)).toEqual(expected);
      expect(await f.db.collection("posts").countDocuments({})).toBe(0);
      expect(await expenses()).toEqual([]);
    });

    it("PATCH with null, a non-list or a client paidBy answers 422 and keeps the stored rows", async () => {
      const post = await seedPost(), url = `${f.path()}/${post.id}`, ana = await member();
      await f.request("PATCH", url, { expense: { ...expense, payments: [row(ana, "percent", 100)] } });
      const before = await expenses();
      for (const [bad, expected] of [[{ payments: null }, "expense.payments/invalid"], [{ shares: "x" }, "expense.shares/invalid"],
        [{ paidBy: ana }, "expense.paidBy/unsupported"]] as const) {
        const response = await f.request("PATCH", url, { expense: bad });
        expect(outcome(response), response.body).toEqual([422, "ValidationError"]);
        expect(fields(response)).toEqual([expected]);
      }
      expect(await expenses()).toEqual(before);
    });

    it("PATCH identifies a former member apart and keeps their rows editable", async () => {
      const post = await seedPost(), url = `${f.path()}/${post.id}`, ana = await member(), beto = await member();
      await f.request("PATCH", url, { expense: { ...expense, payments: [row(ana, "percent", 100)], shares: [row(ana, "amount", 100), row(beto, "remainder")] } });
      await f.db.collection("tripMembers").deleteOne({ tripId: f.trip, userId: new ObjectId(ana) });
      const response = await f.request("PATCH", url, { expense: { breakdown: "cena" } });
      expect(response.statusCode, response.body).toBe(200);
      expect(body(response).expense).toMatchObject({ formerMemberIds: [ana], payments: [row(ana, "percent", 100)], completeness: { status: "complete", reasons: [] } });
      const redistributed = await f.request("PATCH", url, { expense: { payments: [row(beto, "percent", 100)], shares: [row(beto, "remainder")] } });
      expect(body(redistributed).expense).toMatchObject({ formerMemberIds: [] });
    });

    it("keeps the response without an expense byte for byte as before, with POST and PATCH", async () => {
      const created = await f.request("POST", f.path(), { description: "Sin gasto" });
      const { post } = body(created);
      expect(Object.keys(post).sort()).toEqual(["activityId", "authorId", "createdAt", "description", "id", "mapsUrl", "parentPostId", "transportId", "tripId"]);
      expect(created.body).toBe(JSON.stringify({ post }));
      const patched = await f.request("PATCH", `${f.path()}/${post.id}`, { description: "Editado" });
      expect(patched.body).toBe(JSON.stringify({ post: { ...post, description: "Editado" } }));
    });
  });
});
