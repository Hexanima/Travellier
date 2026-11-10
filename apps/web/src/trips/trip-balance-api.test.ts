import { describe, expect, it, vi } from "vitest";
import { createHttpClient } from "../api/index.js";
import { itineraryId } from "./itinerary-test-fixture.js";
import { createTripBalanceApi, balanceReasons } from "./trip-balance-api.js";

const tripId = itineraryId(1), ana = itineraryId(20), beto = itineraryId(21), cata = itineraryId(22);
const setup = (body: unknown, status = 200) => {
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status }));
  const client = createHttpClient({ baseUrl: "https://api.test", fetch, getAccessToken: async () => "token", onUnauthorized: vi.fn() });
  return { api: createTripBalanceApi(client), fetch };
};
const server = { ok: false, error: { kind: "server" } };
const entry = (userId: string, paidCents: number, shareCents: number, formerMember = false) => ({ userId, paidCents, shareCents, netCents: paidCents - shareCents, formerMember });
const ars = () => ({ currency: "ARS", expenseCount: 2, balances: [entry(ana, 3000, 1000), entry(beto, 0, 1000), entry(cata, 0, 1000, true)],
  settlements: [{ fromUserId: beto, toUserId: ana, cents: 1000 }, { fromUserId: cata, toUserId: ana, cents: 1000 }] });
const usd = () => ({ currency: "USD", expenseCount: 1, balances: [entry(ana, 0, 500), entry(beto, 500, 0)], settlements: [{ fromUserId: ana, toUserId: beto, cents: 500 }] });
const excluded = () => ({ expenseId: itineraryId(40), postId: itineraryId(41), currency: null, totalCents: 3000, reasons: ["missing_currency", "missing_shares"], formerMemberIds: [cata] });
const balance = (extra: Record<string, unknown> = {}) => ({ tripId, expenseMode: "balance", currencies: [ars(), usd()], excludedExpenses: [excluded()], includedExpenseCount: 3, ...extra });
const withCurrencies = (...currencies: unknown[]) => balance({ currencies });
const respond = async (body: unknown) => (await setup({ balance: body }).api.get(tripId));

describe("balance HTTP adapter", () => {
  it("reads the balance of two currencies as the server computed it", async () => {
    const { api, fetch } = setup({ balance: balance() });
    expect(await api.get(tripId)).toEqual({ ok: true, value: balance() });
    expect(fetch.mock.calls[0][0]).toBe(`https://api.test/trips/${tripId}/balance`);
    expect(fetch.mock.calls[0][1].method).toBe("GET");
  });
  it("encodes the trip id in the path", async () => {
    const { api, fetch } = setup({ balance: balance() });
    await api.get("a/b");
    expect(fetch.mock.calls[0][0]).toBe("https://api.test/trips/a%2Fb/balance");
  });
  it("compares the trip id ignoring case, as the server lowercases it", async () => {
    const lower = "abcdefabcdefabcdefabcdef", upper = lower.toUpperCase();
    const result = await setup({ balance: balance({ tripId: lower }) }).api.get(upper);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.tripId).toBe(lower);
  });
  it("accepts an empty register-mode answer", async () => {
    const empty = { tripId, expenseMode: "register", currencies: [], excludedExpenses: [], includedExpenseCount: 0 };
    expect(await respond(empty)).toEqual({ ok: true, value: empty });
  });
  it("accepts balance mode without complete expenses", async () => {
    const empty = { tripId, expenseMode: "balance", currencies: [], excludedExpenses: [excluded()], includedExpenseCount: 0 };
    expect(await respond(empty)).toEqual({ ok: true, value: empty });
  });
  it("accepts excluded expenses without amount", async () => {
    const value = balance({ currencies: [], includedExpenseCount: 0, excludedExpenses: [{ ...excluded(), currency: "EUR", totalCents: null, reasons: ["invalid_rules"], formerMemberIds: [] }] });
    expect(await respond(value)).toEqual({ ok: true, value });
  });
  it("knows exactly the seven reasons", () => {
    expect([...balanceReasons]).toEqual(["missing_currency", "missing_payments", "missing_shares", "payments_not_covering_total", "shares_not_covering_total", "no_remainder_participant", "invalid_rules"]);
  });

  it("fails as server when register mode carries data", async () => {
    for (const extra of [{ currencies: [ars()] }, { excludedExpenses: [excluded()] }, { includedExpenseCount: 1 }])
      expect(await respond({ tripId, expenseMode: "register", currencies: [], excludedExpenses: [], includedExpenseCount: 0, ...extra })).toEqual(server);
  });
  it.each([
    ["repeated currency", withCurrencies(ars(), ars())],
    ["unordered currencies", withCurrencies(usd(), ars())],
    ["unknown currency", withCurrencies({ ...ars(), currency: "BRL" })],
    ["unknown reason", balance({ excludedExpenses: [{ ...excluded(), reasons: ["something_new"] }] })],
    ["no reasons", balance({ excludedExpenses: [{ ...excluded(), reasons: [] }] })],
    ["repeated reason", balance({ excludedExpenses: [{ ...excluded(), reasons: ["missing_shares", "missing_shares"] }] })],
    ["net different from paid minus share", withCurrencies({ ...ars(), balances: [{ ...entry(ana, 3000, 1000), netCents: 1999 }, entry(beto, 0, 1000), entry(cata, 0, 1000)] })],
    ["fractional cents", withCurrencies({ ...ars(), balances: [{ ...entry(ana, 3000.5, 1000), netCents: 2000.5 }, entry(beto, 0, 1000), entry(cata, 0, 1000)] })],
    ["negative paid", withCurrencies({ ...ars(), balances: [entry(ana, -1, 0), entry(beto, 1, 0)], settlements: [] })],
    ["unsafe cents", withCurrencies({ ...ars(), balances: [entry(ana, 2 ** 53, 0), entry(beto, 0, 2 ** 53)], settlements: [] })],
    ["net not summing zero", withCurrencies({ ...ars(), balances: [entry(ana, 3000, 1000), entry(beto, 0, 500)] , settlements: [] })],
    ["settlement to the same person", withCurrencies({ ...ars(), settlements: [{ fromUserId: ana, toUserId: ana, cents: 1000 }] })],
    ["settlement without cents", withCurrencies({ ...ars(), settlements: [{ fromUserId: beto, toUserId: ana, cents: 0 }] })],
    ["settlement of someone outside the balances", withCurrencies({ ...ars(), settlements: [{ fromUserId: itineraryId(99), toUserId: ana, cents: 1 }] })],
    ["repeated person", withCurrencies({ ...ars(), balances: [entry(ana, 0, 0), entry(ana, 0, 0)], settlements: [] })],
    ["another trip", balance({ tripId: itineraryId(2) })],
    ["invalid id", withCurrencies({ ...ars(), balances: [entry("x", 0, 0)], settlements: [] })],
    ["unknown mode", balance({ expenseMode: "other" })],
    ["negative total", balance({ excludedExpenses: [{ ...excluded(), totalCents: -1 }] })],
    ["invalid former id", balance({ excludedExpenses: [{ ...excluded(), formerMemberIds: ["x"] }] })],
    ["non-boolean former mark", withCurrencies({ ...ars(), balances: [{ ...entry(ana, 0, 0), formerMember: "no" }], settlements: [] })],
    ["invalid included count", balance({ includedExpenseCount: -1 })],
  ])("fails as server on %s", async (_name, value) => { expect(await respond(value)).toEqual(server); });
  it("fails as server without a balance or with another shape", async () => {
    expect(await setup({}).api.get(tripId)).toEqual(server);
    expect(await setup({ balance: null }).api.get(tripId)).toEqual(server);
    expect(await setup([]).api.get(tripId)).toEqual(server);
  });

  it.each([[401, "unauthorized"], [404, "not-found"], [400, "validation"], [503, "server"]] as const)("maps %s to %s without payload data", async (status, kind) => {
    const result = await setup({ error: { code: "X", message: "secreto 12345" } }, status).api.get(tripId);
    expect(result).toMatchObject({ ok: false, error: { kind } });
    expect(JSON.stringify(result)).not.toContain("secreto");
  });
});
