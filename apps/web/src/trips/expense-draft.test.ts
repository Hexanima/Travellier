import { describe, expect, it } from "vitest";
import { diffExpense, expenseDraftFromSaved, parseAmount, sameExpense, validateExpense, type ExpenseDraft } from "./expense-draft.js";

const draft = (overrides: Partial<ExpenseDraft> = {}): ExpenseDraft => ({ amount: "25,50", currency: "ARS", breakdown: "", ...overrides });

describe("parseAmount", () => {
  it.each([["12,5", 1250, 12.5], ["12.50", 1250, 12.5], ["1000", 100000, 1000], [" 7 ", 700, 7], ["0,01", 1, 0.01], ["0.1", 10, 0.1]])("accepts %s", (raw, cents, amount) => {
    expect(parseAmount(raw)).toEqual({ ok: true, cents, amount });
  });
  it("rejects more than two decimals as a precision error, without rounding", () => {
    expect(parseAmount("12,345")).toEqual({ ok: false, code: "precision" });
    expect(parseAmount("12.001")).toEqual({ ok: false, code: "precision" });
  });
  it("rejects empty as required", () => {
    expect(parseAmount("")).toEqual({ ok: false, code: "required" });
    expect(parseAmount("   ")).toEqual({ ok: false, code: "required" });
  });
  it.each(["0", "0,00", "-1", "abc", "1.234,50", "1,2,3", "12,", ",5", "1e3", "+5"])("rejects %s as invalid", (raw) => {
    expect(parseAmount(raw)).toEqual({ ok: false, code: "invalid" });
  });
  it("rejects an amount that is not a safe number", () => {
    expect(parseAmount("99999999999999999999")).toEqual({ ok: false, code: "invalid" });
  });
  it.each(["70368744177664,01", "70368744177664.01", "70368744177664,04", "70368744177665,01", "90071992547409,91", "90071992547409,99", "900719925474099,99", "99999999999999999999,99"])(
    "rejects %s: the number that travels would not represent exactly the typed text", (raw) => {
      expect(parseAmount(raw)).toEqual({ ok: false, code: "invalid" });
    });
  it.each([["70368744177663,99", 7036874417766399], ["70368744177664,00", 7036874417766400], ["70368744177664,50", 7036874417766450], ["9007199254740,99", 900719925474099],
    ["1000000000000,01", 100000000000001]])("accepts %s, exactly representable", (raw, cents) => {
    const parsed = parseAmount(raw);
    expect(parsed.ok && parsed.cents).toBe(cents);
    expect(parsed.ok && parsed.amount).toBe(Number(raw.replace(",", ".")));
  });
});

describe("validateExpense", () => {
  it("requires a currency without defaulting one", () => {
    expect(validateExpense(draft({ currency: "" }))).toEqual({ ok: false, errors: { currency: "required" } });
  });
  it("reports amount and currency together", () => {
    expect(validateExpense(draft({ amount: "x", currency: "" }))).toEqual({ ok: false, errors: { amount: "invalid", currency: "required" } });
  });
  it("returns the typed value with a trimmed breakdown", () => {
    expect(validateExpense(draft({ breakdown: "  cena  " }))).toEqual({ ok: true, value: { totalAmount: 25.5, currency: "ARS", breakdown: "cena" }, cents: 2550 });
    expect(validateExpense(draft())).toEqual({ ok: true, value: { totalAmount: 25.5, currency: "ARS", breakdown: null }, cents: 2550 });
  });
});

describe("sameExpense / expenseDraftFromSaved", () => {
  it("compares by field", () => {
    expect(sameExpense(draft(), draft())).toBe(true);
    expect(sameExpense(draft(), draft({ breakdown: "x" }))).toBe(false);
    expect(sameExpense(null, null)).toBe(true);
    expect(sameExpense(draft(), null)).toBe(false);
  });
  it("builds the form values of a saved expense, with no float noise and no assumed currency", () => {
    expect(expenseDraftFromSaved({ totalAmount: 25.5, currency: "EUR", breakdown: "a" })).toEqual({ amount: "25,50", currency: "EUR", breakdown: "a" });
    expect(expenseDraftFromSaved({ totalAmount: 1000, currency: null, breakdown: null })).toEqual({ amount: "1000", currency: "", breakdown: "" });
    expect(expenseDraftFromSaved({ totalAmount: 0.1 + 0.2, currency: "USD", breakdown: null }).amount).toBe("0,30");
  });
});

describe("diffExpense", () => {
  const saved = { totalAmount: 25.5, currency: "ARS" as const, breakdown: "cena" };
  it("without a saved expense sends amount and currency, and the breakdown only when written", () => {
    expect(diffExpense(draft())).toEqual({ totalAmount: 25.5, currency: "ARS" });
    expect(diffExpense(draft({ breakdown: " vino " }))).toEqual({ totalAmount: 25.5, currency: "ARS", breakdown: "vino" });
  });
  it("sends only what changed against the saved one", () => {
    expect(diffExpense(draft({ breakdown: "cena" }), saved)).toEqual({});
    expect(diffExpense(draft({ amount: "30", breakdown: "cena" }), saved)).toEqual({ totalAmount: 30 });
    expect(diffExpense(draft({ currency: "USD", breakdown: "cena" }), saved)).toEqual({ currency: "USD" });
    expect(diffExpense(draft({ breakdown: "postre" }), saved)).toEqual({ breakdown: "postre" });
  });
  it("compares the amount by cents, not by text", () => {
    expect(diffExpense(draft({ amount: "25.5", breakdown: "cena" }), saved)).toEqual({});
  });
  it("clears the breakdown with null only over a saved value", () => {
    expect(diffExpense(draft({ breakdown: "  " }), saved)).toEqual({ breakdown: null });
    expect(diffExpense(draft({ breakdown: "" }), { ...saved, breakdown: null })).toEqual({});
  });
  it("always sends the currency when the saved one is missing (legacy)", () => {
    expect(diffExpense(draft({ breakdown: "cena" }), { ...saved, currency: null })).toEqual({ currency: "ARS" });
  });
  it("never carries payments or shares", () => {
    expect(Object.keys(diffExpense(draft({ amount: "1", breakdown: "cena" }), saved)).sort()).toEqual(["totalAmount"]);
  });
  it("sends nothing for a draft that is not valid", () => {
    expect(diffExpense(draft({ amount: "abc" }), saved)).toEqual({});
  });
});
