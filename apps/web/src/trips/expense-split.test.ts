import { describe, expect, it } from "vitest";
import { itineraryId } from "./itinerary-test-fixture.js";
import { parseAmount } from "./expense-draft.js";
import { unknownPeople, type PhotoPeople } from "./photo-people.js";
import { canPropose, checkSplit, commitSplit, emptySplit, formerLabels, includeAll, includeMember, mapSplitFieldErrors, parseRowValue, proposeShares,
  sameSplit, savedSplit, sentSplitKeys, splitInput, splitTotals, type PaymentRow, type ShareRow } from "./expense-split.js";
import type { SavedExpenseView } from "./trip-post-api.js";

const [ana, beto, caro, dani] = [itineraryId(30), itineraryId(31), itineraryId(32), itineraryId(33)];
const pay = (key: string, userId: string, unit: PaymentRow["unit"], value: string): PaymentRow => ({ key, userId, unit, value });
const share = (key: string, userId: string, unit: ShareRow["unit"], value = ""): ShareRow => ({ key, userId, unit, value });
const total = (cents: number, currency: "ARS" | "EUR" | "USD" = "ARS") => ({ totalAmount: cents / 100, totalCents: cents, currency });
const saved = (extra: Partial<SavedExpenseView> = {}): SavedExpenseView => ({ postId: itineraryId(5), totalAmount: 100, currency: "ARS", breakdown: null, payments: [], shares: [],
  completeness: { status: "incomplete", reasons: [] }, formerMemberIds: [], ...extra });
const people = (members: string[], loaded = true): PhotoPeople => loaded
  ? { loaded: true, currentUserId: ana, names: new Map(members.map((id, index): [string, string] => [id, `Persona ${index + 1}`])) } : unknownPeople;

describe("parseAmount with allowZero", () => {
  it("rejects zero by default and accepts it only when asked, without changing the other rules", () => {
    expect(parseAmount("0")).toEqual({ ok: false, code: "invalid" });
    expect(parseAmount("0,00", { allowZero: true })).toEqual({ ok: true, cents: 0, amount: 0 });
    expect(parseAmount("-1", { allowZero: true })).toEqual({ ok: false, code: "invalid" });
    expect(parseAmount("1,234", { allowZero: true })).toEqual({ ok: false, code: "precision" });
  });
});

describe("parseRowValue", () => {
  it("accepts comma and dot with up to two decimals, exactly", () => {
    expect(parseRowValue("amount", "12,5", false)).toEqual({ ok: true, value: 12.5 });
    expect(parseRowValue("amount", "12.50", false)).toEqual({ ok: true, value: 12.5 });
    expect(parseRowValue("percent", "33,33", false)).toEqual({ ok: true, value: 33.33 });
    expect(parseRowValue("percent", "100", false)).toEqual({ ok: true, value: 100 });
  });
  it("rejects empty, more than two decimals, text, negatives and percentages over 100", () => {
    expect(parseRowValue("amount", "", false)).toEqual({ ok: false, code: "required" });
    expect(parseRowValue("amount", "1,234", false)).toEqual({ ok: false, code: "precision" });
    expect(parseRowValue("percent", "12,345", false)).toEqual({ ok: false, code: "precision" });
    expect(parseRowValue("amount", "abc", false)).toEqual({ ok: false, code: "invalid" });
    expect(parseRowValue("amount", "-5", false)).toEqual({ ok: false, code: "invalid" });
    expect(parseRowValue("percent", "100,01", false)).toEqual({ ok: false, code: "range" });
  });
  it("accepts zero only for rows that were already saved", () => {
    expect(parseRowValue("amount", "0", false)).toEqual({ ok: false, code: "invalid" });
    expect(parseRowValue("amount", "0", true)).toEqual({ ok: true, value: 0 });
  });
});

describe("splitTotals", () => {
  it("uses the typed expense when valid, the saved one when untouched, and blocks without amount or currency", () => {
    expect(splitTotals({ amount: "250,50", currency: "USD", breakdown: "" }, saved())).toEqual({ ok: true, totals: total(25050, "USD") });
    expect(splitTotals(null, saved({ totalAmount: 100, currency: "EUR" }))).toEqual({ ok: true, totals: total(10000, "EUR") });
    expect(splitTotals(null, undefined)).toEqual({ ok: false });
    expect(splitTotals(null, saved({ currency: null }))).toEqual({ ok: false });
    expect(splitTotals({ amount: "", currency: "ARS", breakdown: "" }, saved())).toEqual({ ok: false });
    expect(splitTotals({ amount: "5", currency: "", breakdown: "" }, saved())).toEqual({ ok: false });
  });
});

describe("checkSplit", () => {
  it("shows what is missing for payments and shares independently, without blocking", () => {
    const check = checkSplit(total(10000), { payments: [pay("a", ana, "amount", "40")], shares: [share("b", ana, "percent", "30")] });
    expect(check.valid).toBe(true);
    expect(check.payments.summary).toMatchObject({ coveredCents: 4000, missingCents: 6000, excessCents: 0 });
    expect(check.shares.summary).toMatchObject({ coveredCents: 3000, missingCents: 7000, excessCents: 0 });
    expect(check.payments.listError).toBeUndefined();
  });
  it("blocks and shows the excess when fixed amounts or percentages go over the total", () => {
    const check = checkSplit(total(10000), { payments: [pay("a", ana, "amount", "120")], shares: [share("b", ana, "percent", "60"), share("c", beto, "percent", "50")] });
    expect(check.valid).toBe(false);
    expect(check.payments.valid).toBe(false);
    expect(check.payments.summary).toMatchObject({ excessCents: 2000, missingCents: 0 });
    expect(check.payments.listError).toMatch(/Sobran/);
    expect(check.shares.valid).toBe(false);
    expect(check.shares.listError).toMatch(/superan|Sobran/);
  });
  it("keeps the sections independent: an invalid one does not invalidate the other", () => {
    const check = checkSplit(total(10000), { payments: [pay("a", ana, "amount", "abc")], shares: [share("b", ana, "percent", "100")] });
    expect(check.payments.valid).toBe(false);
    expect(check.payments.rowErrors.a).toBeTruthy();
    expect(check.shares.valid).toBe(true);
  });
  it("reports a row error for bad values, a missing value and a duplicated person in shares only", () => {
    const check = checkSplit(total(10000), { payments: [pay("a", ana, "amount", "1"), pay("b", ana, "amount", "2")],
      shares: [share("c", ana, "percent", "10"), share("d", ana, "amount", "5"), share("e", beto, "amount", "")] });
    expect(check.payments.valid).toBe(true);
    expect(check.shares.rowErrors.c).toBeUndefined();
    expect(check.shares.rowErrors.d).toMatch(/ya tiene/);
    expect(check.shares.rowErrors.e).toBeTruthy();
  });
  it("accepts several payments of the same person", () => {
    const check = checkSplit(total(10000), { payments: [pay("a", ana, "amount", "30"), pay("b", ana, "percent", "70")], shares: [] });
    expect(check.payments.valid).toBe(true);
    expect(check.payments.summary).toMatchObject({ coveredCents: 10000, missingCents: 0 });
  });
  it("splits the cent residue of 3 equal percentages as 33,33 / 33,33 / 33,34", () => {
    const check = checkSplit(total(10000), { payments: [], shares: [share("a", ana, "percent", "33,33"), share("b", beto, "percent", "33,33"), share("c", caro, "percent", "33,34")] });
    expect(check.shares.valid).toBe(true);
    expect(check.shares.summary).toMatchObject({ coveredCents: 10000, missingCents: 0 });
    expect(check.incomplete.shares ?? []).toEqual([]);
  });
  it("splits the remainder of 1000 between three people as 333,34 / 333,33 / 333,33", () => {
    const check = checkSplit(total(100000), { payments: [], shares: [share("a", ana, "remainder"), share("b", beto, "remainder"), share("c", caro, "remainder")] });
    expect(check.shares.valid).toBe(true);
    expect(check.shares.remainderCents).toEqual({ a: 33334, b: 33333, c: 33333 });
  });
  it("percentages follow the total while fixed amounts stay fixed", () => {
    const rows = { payments: [], shares: [share("a", ana, "amount", "20"), share("b", beto, "percent", "50"), share("c", caro, "remainder")] };
    const low = checkSplit(total(10000), rows), high = checkSplit(total(20000), rows);
    expect(low.shares.remainderCents).toEqual({ c: 3000 });
    expect(high.shares.remainderCents).toEqual({ c: 8000 });
    // Lowering the total below the fixed amounts makes the list exceed it.
    const lower = checkSplit(total(1500), rows);
    expect(lower.shares.valid).toBe(false);
    expect(lower.shares.listError).toBeTruthy();
  });
  it("lists the incomplete reasons without blocking: no payments, no shares, nobody takes the rest", () => {
    const empty = checkSplit(total(10000), { payments: [], shares: [] });
    expect(empty.valid).toBe(true);
    expect(empty.incomplete.payments?.length).toBeGreaterThan(0);
    expect(empty.incomplete.shares?.length).toBeGreaterThan(0);
    const excluded = checkSplit(total(10000), { payments: [], shares: [share("a", ana, "excluded")] });
    expect(excluded.valid).toBe(true);
    expect(excluded.incomplete.shares?.length).toBeGreaterThan(0);
  });
  it("does not report a remainder participant as missing coverage", () => {
    const check = checkSplit(total(10000), { payments: [pay("a", ana, "percent", "100")], shares: [share("b", ana, "remainder")] });
    expect(check.incomplete).toEqual({});
  });
});

describe("checkSplit summary", () => {
  it("covers the total when everyone is on remainder", () => {
    const check = checkSplit(total(10000), { payments: [], shares: [share("a", ana, "remainder"), share("b", beto, "remainder")] });
    expect(check.shares.summary).toMatchObject({ coveredCents: 10000, missingCents: 0, excessCents: 0 });
  });
  it("covers the total with remainder plus fixed amounts", () => {
    const check = checkSplit(total(10000), { payments: [], shares: [share("a", ana, "amount", "20"), share("b", beto, "remainder")] });
    expect(check.shares.summary).toMatchObject({ coveredCents: 10000, missingCents: 0, excessCents: 0 });
  });
  it("absorbs the percentage residue of a total that is not a multiple (10,00 with 33,34 / 33,33 / 33,33)", () => {
    const check = checkSplit(total(1000), { payments: [], shares: [share("a", ana, "percent", "33,34"), share("b", beto, "percent", "33,33"), share("c", caro, "percent", "33,33")] });
    expect(check.shares.valid).toBe(true);
    expect(check.shares.summary).toMatchObject({ coveredCents: 1000, missingCents: 0, excessCents: 0 });
  });
  it("reports the real shortfall of incomplete payments", () => {
    const check = checkSplit(total(10000), { payments: [pay("a", ana, "amount", "25,50")], shares: [] });
    expect(check.payments.summary).toMatchObject({ coveredCents: 2550, missingCents: 7450, excessCents: 0 });
  });
  it("reports the excess", () => {
    const check = checkSplit(total(10000), { payments: [pay("a", ana, "amount", "100,01")], shares: [] });
    expect(check.payments.summary).toMatchObject({ excessCents: 1, missingCents: 0 });
  });
  it("reads cents exactly, without floating point (1,15 is 115 cents)", () => {
    const check = checkSplit(total(10000), { payments: [pay("a", ana, "amount", "1,15"), pay("b", beto, "amount", "4,35")], shares: [] });
    expect(check.payments.summary).toMatchObject({ coveredCents: 550, missingCents: 9450 });
  });
});

describe("proposal and explicit inclusion", () => {
  it("proposes one remainder row per current member (no payer) only for a new or empty split", () => {
    const rows = proposeShares([ana, beto]);
    expect(rows.map(({ userId, unit, value }) => ({ userId, unit, value }))).toEqual([{ userId: ana, unit: "remainder", value: "" }, { userId: beto, unit: "remainder", value: "" }]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(2);
    expect(canPropose(undefined, emptySplit())).toBe(true);
    expect(canPropose(saved(), emptySplit())).toBe(true);
    expect(canPropose(saved({ shares: [{ userId: ana, unit: "excluded", value: null }] }), emptySplit())).toBe(false);
    expect(canPropose(undefined, { payments: null, shares: [] })).toBe(false);
  });
  it("includes a person without duplicating and with remainder by default; includeAll adds only the missing ones", () => {
    const base = [share("a", ana, "percent", "50")];
    expect(includeMember(base, ana)).toBe(base);
    const withBeto = includeMember(base, beto);
    expect(withBeto.map((row) => [row.userId, row.unit])).toEqual([[ana, "percent"], [beto, "remainder"]]);
    const all = includeAll(withBeto, [ana, beto, caro, dani]);
    expect(all.map((row) => row.userId)).toEqual([ana, beto, caro, dani]);
    expect(includeAll(all, [ana, beto, caro, dani])).toBe(all);
  });
  it("includes new members without removing the former members already in the split", () => {
    const former = savedSplit(saved({ shares: [{ userId: dani, unit: "amount", value: 10 }] })).shares;
    const next = includeAll(former, [ana, beto]);
    expect(next.map((row) => row.userId)).toEqual([dani, ana, beto]);
  });
});

describe("former members", () => {
  it("labels absent users as «Ex integrante N» by order of appearance and keeps current members out", () => {
    const labels = formerLabels(people([ana, beto]), [pay("a", dani, "amount", "0"), pay("b", ana, "amount", "5")], [share("c", caro, "excluded"), share("d", dani, "excluded")]);
    expect(labels.get(dani)).toBe("Ex integrante 1");
    expect(labels.get(caro)).toBe("Ex integrante 2");
    expect(labels.has(ana)).toBe(false);
  });
  it("cannot tell former members without the member list", () => {
    expect(formerLabels(people([], false), [pay("a", dani, "amount", "1")], []).size).toBe(0);
  });
});

describe("splitInput (merge-patch against what is stored)", () => {
  const storedView = saved({ payments: [{ userId: ana, unit: "amount", value: 40 }], shares: [{ userId: ana, unit: "percent", value: 50 }, { userId: beto, unit: "remainder", value: null }] });
  it("sends nothing for untouched lists and for lists equal to the saved ones, even typed another way", () => {
    expect(splitInput(emptySplit(), storedView)).toEqual({});
    expect(splitInput({ payments: [pay("x", ana, "amount", "40,00")], shares: [share("y", ana, "percent", "50"), share("z", beto, "remainder")] }, storedView)).toEqual({});
  });
  it("sends a list that changed in unit, value, person or order", () => {
    expect(splitInput({ payments: [pay("x", ana, "amount", "41")], shares: null }, storedView)).toEqual({ payments: [{ userId: ana, unit: "amount", value: 41 }] });
    expect(splitInput({ payments: null, shares: [share("z", beto, "remainder"), share("y", ana, "percent", "50")] }, storedView))
      .toEqual({ shares: [{ userId: beto, unit: "remainder", value: null }, { userId: ana, unit: "percent", value: 50 }] });
    expect(splitInput({ payments: [pay("x", ana, "percent", "40")], shares: null }, storedView)).toEqual({ payments: [{ userId: ana, unit: "percent", value: 40 }] });
  });
  it("sends [] only when the person emptied a list that had rows", () => {
    expect(splitInput({ payments: [], shares: [] }, storedView)).toEqual({ payments: [], shares: [] });
    expect(splitInput({ payments: [], shares: [] }, saved())).toEqual({});
    expect(splitInput({ payments: [], shares: [] }, undefined)).toEqual({});
  });
  it("on creation sends only the non-empty lists", () => {
    expect(splitInput({ payments: [pay("x", ana, "amount", "5")], shares: [] }, undefined)).toEqual({ payments: [{ userId: ana, unit: "amount", value: 5 }] });
  });
  it("does not resend a legacy payer read as 100 percent unless it changed", () => {
    const legacy = saved({ payments: [{ userId: dani, unit: "percent", value: 100 }] });
    expect(splitInput({ payments: [pay("x", dani, "percent", "100")], shares: null }, legacy)).toEqual({});
    expect(splitInput({ payments: [pay("x", dani, "percent", "60")], shares: null }, legacy)).toEqual({ payments: [{ userId: dani, unit: "percent", value: 60 }] });
  });
  it("never sends a list with an unparseable row", () => {
    expect(splitInput({ payments: [pay("x", ana, "amount", "abc")], shares: null }, storedView)).toEqual({});
  });
});

describe("commitSplit and sameSplit", () => {
  const storedView = saved({ payments: [{ userId: ana, unit: "amount", value: 40 }], shares: [{ userId: ana, unit: "remainder", value: null }] });
  it("stores null for a section equal to the saved one and the rows for the one that changed", () => {
    const working = savedSplit(storedView);
    expect(commitSplit({ payments: working.payments!, shares: working.shares! }, storedView)).toEqual(emptySplit());
    const edited = commitSplit({ payments: working.payments!.map((row) => ({ ...row, value: "50" })), shares: working.shares! }, storedView);
    expect(edited.shares).toBeNull();
    expect(edited.payments).toHaveLength(1);
  });
  it("confirms a proposal over an empty saved split", () => {
    const proposal = proposeShares([ana, beto]);
    expect(commitSplit({ payments: [], shares: proposal }, undefined)).toEqual({ payments: null, shares: proposal });
  });
  it("compares splits ignoring the editor keys", () => {
    expect(sameSplit({ payments: [pay("a", ana, "amount", "1")], shares: null }, { payments: [pay("b", ana, "amount", "1")], shares: null })).toBe(true);
    expect(sameSplit({ payments: [pay("a", ana, "amount", "1")], shares: null }, emptySplit())).toBe(false);
  });
  it("keeps the saved rows with stable keys for each list", () => {
    const first = savedSplit(storedView), second = savedSplit(storedView);
    expect(first.payments![0]!.key).toBe(second.payments![0]!.key);
    expect(first.payments![0]!.key).not.toBe(first.shares![0]!.key);
  });
});

describe("server errors by row", () => {
  it("maps the indexes of the sent lists back to the row keys and keeps list errors apart", () => {
    const keys = sentSplitKeys({ payments: [pay("p0", ana, "amount", "1"), pay("p1", beto, "amount", "2")], shares: [share("s0", ana, "remainder")] });
    expect(keys).toEqual({ payments: ["p0", "p1"], shares: ["s0"] });
    const mapped = mapSplitFieldErrors([
      { field: "expense.shares[0].userId", code: "duplicate_user", message: "x" },
      { field: "expense.payments[1].value", code: "invalid_value", message: "x" },
      { field: "expense.payments[0].userId", code: "not_member", message: "x" },
      { field: "expense.payments", code: "exceeds_total", message: "x" },
    ], keys);
    expect(Object.keys(mapped.rowErrors).sort()).toEqual(["p0", "p1", "s0"]);
    expect(mapped.listErrors.payments).toMatch(/excede|Sobran/i);
    expect(mapped.handled).toBe(true);
  });
  it("is not handled when the field is not a payments or shares one or the index is unknown", () => {
    const keys = { payments: ["p0"], shares: [] as string[] };
    expect(mapSplitFieldErrors([{ field: "expense.totalAmount", code: "invalid", message: "x" }], keys).handled).toBe(false);
    expect(mapSplitFieldErrors([{ field: "expense.shares[3].value", code: "invalid_value", message: "x" }], keys).handled).toBe(false);
  });
});
