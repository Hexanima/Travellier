import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { handleApiRequest } from "../app.js";
import { PostFixture } from "../../test/post-fixture.js";

describe("trip balance HTTP API (T82)", () => {
  const f = new PostFixture();
  beforeAll(() => f.start("balance_http"), 120_000);
  afterAll(() => f.stop());
  beforeEach(async () => { await f.reset(); });

  const body = (response: { body?: string }) => JSON.parse(response.body ?? "null");
  const url = () => `/trips/${f.trip}/balance`;
  const get = (user = f.actor, path = url()) => f.request("GET", path, undefined, user);
  const setMode = async (expenseMode: "register" | "balance") => {
    await f.db.collection("tripMembers").updateOne({ tripId: f.trip, userId: f.actor }, { $set: { role: "admin" } });
    await f.db.collection("trips").updateOne({ _id: f.trip }, { $set: { name: "Viaje", description: null, ownerId: f.actor, createdBy: f.actor, createdAt: new Date() } });
    const configured = await f.request("PATCH", `/trips/${f.trip}/config`, { expenseMode });
    expect(configured.statusCode, configured.body).toBe(200);
  };
  const member = async () => {
    const userId = new ObjectId();
    await f.db.collection("tripMembers").insertOne({ tripId: f.trip, userId, role: "participant", joinedAt: new Date() });
    return userId.toHexString();
  };
  const post = async (expense?: unknown) => {
    const response = await f.request("POST", f.path(), { description: "Cena", ...(expense === undefined ? {} : { expense }) });
    expect(response.statusCode, response.body).toBe(201);
    return body(response) as { post: { id: string }; expense?: { id: string } };
  };
  const pct = (userId: string | ObjectId, value = 100) => ({ userId: userId.toString(), unit: "percent", value });
  const rest = (userId: string | ObjectId) => ({ userId: userId.toString(), unit: "remainder", value: null });
  const balanceOf = async (user = f.actor) => { const response = await get(user); expect(response.statusCode, response.body).toBe(200); return body(response).balance; };
  const actor = () => f.actor.toHexString();
  const stored = () => f.db.collection("postExpenses").find().sort({ _id: 1 }).toArray();

  it("answers 200 with the balance shape for real expenses saved through the posts API", async () => {
    await setMode("balance");
    const other = await member();
    await post({ totalAmount: 100.01, currency: "ARS", payments: [pct(actor())], shares: [rest(actor()), rest(other)] });
    await post({ totalAmount: 20, currency: "USD", payments: [pct(other)], shares: [rest(actor()), rest(other)] });
    const response = await get();
    expect(response.statusCode, response.body).toBe(200);
    expect(Object.keys(body(response))).toEqual(["balance"]);
    const balance = body(response).balance;
    expect(Object.keys(balance).sort()).toEqual(["currencies", "excludedExpenses", "expenseMode", "includedExpenseCount", "tripId"]);
    expect(balance).toMatchObject({ tripId: f.trip.toHexString(), expenseMode: "balance", includedExpenseCount: 2, excludedExpenses: [] });
    expect(balance.currencies.map((entry: { currency: string }) => entry.currency)).toEqual(["ARS", "USD"]);
    const ars = balance.currencies[0];
    expect(Object.keys(ars).sort()).toEqual(["balances", "currency", "expenseCount", "settlements"]);
    expect(ars.balances.find((row: { userId: string }) => row.userId === actor())).toEqual({
      userId: actor(), paidCents: 10001, shareCents: 5001, netCents: 5000, formerMember: false });
    expect(ars.settlements).toEqual([{ fromUserId: other, toUserId: actor(), cents: 5000 }]);
    expect(balance.currencies[1].settlements).toEqual([{ fromUserId: actor(), toUserId: other, cents: 1000 }]);
  });

  it("answers 401 without a session, 400 for an invalid id and 404 for a non-member or unknown Trip", async () => {
    expect((await handleApiRequest({ method: "GET", url: url() }, { trips: f.api })).statusCode).toBe(401);
    expect((await get(f.actor, "/trips/not-an-id/balance")).statusCode).toBe(400);
    const stranger = await get(new ObjectId());
    expect(stranger.statusCode).toBe(404);
    expect(body(stranger).error.code).toBe("TripNotFoundError");
    expect((await get(f.actor, `/trips/${new ObjectId()}/balance`)).statusCode).toBe(404);
  });

  it("answers 503 when the dependency is not wired", async () => {
    const without = { ...f.api } as Record<string, unknown>;
    delete without.getBalance;
    const response = await handleApiRequest({ method: "GET", url: url(), authenticatedUserId: f.actor.toHexString() as never }, { trips: without } as never);
    expect(response.statusCode).toBe(503);
  });

  it("reads a legacy paidBy without payments as a 100% payment, excluded for lacking shares", async () => {
    await setMode("balance");
    const created = await post({ totalAmount: 50, currency: "ARS", payments: [pct(actor())], shares: [rest(actor())] });
    const legacyPost = await post();
    await f.db.collection("postExpenses").insertOne({ _id: new ObjectId(), tripId: f.trip, postId: new ObjectId(legacyPost.post.id), totalAmount: 30, paidBy: f.actor, createdAt: new Date() });
    const balance = await balanceOf();
    expect(balance.includedExpenseCount).toBe(1);
    expect(created.expense).toBeDefined();
    expect(balance.excludedExpenses).toEqual([expect.objectContaining({ postId: legacyPost.post.id, currency: null, totalCents: 3000, formerMemberIds: [],
      reasons: ["missing_currency", "missing_shares"] })]);
  });

  it("keeps an expelled member's payments and shares in the balance identified as former member", async () => {
    await setMode("balance");
    const other = await member();
    await post({ totalAmount: 100, currency: "EUR", payments: [pct(other)], shares: [rest(actor()), rest(other)] });
    expect((await f.request("DELETE", `/trips/${f.trip}/members/${other}`)).statusCode).toBe(204);
    const balance = await balanceOf();
    const eur = balance.currencies[0];
    expect(eur.balances).toEqual(expect.arrayContaining([
      { userId: other, paidCents: 10000, shareCents: 5000, netCents: 5000, formerMember: true },
      { userId: actor(), paidCents: 0, shareCents: 5000, netCents: -5000, formerMember: false }]));
    expect(eur.settlements).toEqual([{ fromUserId: actor(), toUserId: other, cents: 5000 }]);
    expect((await get(new ObjectId(other))).statusCode).toBe(404);
  });

  it("switching expenseMode only changes the view: stored expenses are identical and the GET writes nothing", async () => {
    await setMode("balance");
    await post({ totalAmount: 40, currency: "ARS", payments: [pct(actor())], shares: [rest(actor())] });
    const before = await stored();
    expect((await balanceOf()).currencies).toHaveLength(1);
    await setMode("register");
    expect(await balanceOf()).toMatchObject({ expenseMode: "register", currencies: [], excludedExpenses: [], includedExpenseCount: 0 });
    expect(await stored()).toEqual(before);
    await setMode("balance");
    expect((await balanceOf()).currencies).toHaveLength(1);
    expect(await stored()).toEqual(before);
    const [trips, members] = await Promise.all([f.db.collection("trips").find().toArray(), f.db.collection("tripMembers").find().toArray()]);
    await get(); await get();
    expect(await stored()).toEqual(before);
    expect(await f.db.collection("trips").find().toArray()).toEqual(trips);
    expect(await f.db.collection("tripMembers").find().toArray()).toEqual(members);
  });

  it("recomputes after editing the split and reports incomplete expenses with their reasons", async () => {
    await setMode("balance");
    const other = await member();
    const complete = await post({ totalAmount: 100, currency: "ARS", payments: [pct(actor())], shares: [rest(actor())] });
    const incomplete = await post({ totalAmount: 10, currency: "USD" });
    const first = await balanceOf();
    expect(first.currencies[0].settlements).toEqual([]);
    expect(first.excludedExpenses).toEqual([expect.objectContaining({ postId: incomplete.post.id, currency: "USD", totalCents: 1000, reasons: ["missing_payments", "missing_shares"] })]);
    const edited = await f.request("PATCH", `${f.path()}/${complete.post.id}`, { expense: { shares: [rest(actor()), rest(other)] } });
    expect(edited.statusCode, edited.body).toBe(200);
    const second = await balanceOf();
    expect(second.currencies[0].settlements).toEqual([{ fromUserId: other, toUserId: actor(), cents: 5000 }]);
    expect(second.excludedExpenses).toHaveLength(1);
  });

  it("orders excluded expenses and balances in a stable way and ignores expenses without a post in the Trip", async () => {
    await setMode("balance");
    const a = await post({ totalAmount: 10, currency: "ARS" });
    const b = await post({ totalAmount: 20, currency: "ARS" });
    await f.db.collection("postExpenses").insertOne({ _id: new ObjectId(), tripId: f.trip, postId: new ObjectId(), totalAmount: 99, currency: "ARS", payments: [], shares: [], createdAt: new Date() });
    const first = await balanceOf(), second = await balanceOf();
    expect(first).toEqual(second);
    expect(first.excludedExpenses.map((row: { postId: string }) => row.postId)).toEqual([a.post.id, b.post.id]);
  });
});
