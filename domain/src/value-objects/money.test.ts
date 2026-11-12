import { describe, expect, it } from "vitest";
import { CURRENCIES, MAX_AMOUNT, MAX_AMOUNT_CENTS, checkWritableAmount, createCurrency, toCents } from "./money.js";

describe("money value object", () => {
  it("exposes exactly ARS, EUR and USD", () => {
    expect([...CURRENCIES]).toEqual(["ARS", "EUR", "USD"]);
  });
  it.each(["ARS", "EUR", "USD"])("accepts %s", (currency) => {
    expect(createCurrency(currency)).toEqual({ ok: true, value: currency });
  });
  it.each(["BRL", "usd", "", undefined, null, 1, {}])("rejects %s", (currency) => {
    const result = createCurrency(currency);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.issues.map(({ field }) => field)).toEqual(["currency"]);
  });
  it.each([
    [0, 0], [0.01, 1], [1, 100], [1.005, 101], [2.675, 268], [0.005, 1],
    [1.0049999999999997, 100], [5e-7, 0], [42.5, 4250], [90071992547409.9, 9007199254740990],
  ])("converts %s to %s cents half-up", (decimal, cents) => {
    expect(toCents(decimal)).toEqual({ ok: true, value: cents });
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, -0.01, 1e21, 90071992547409.92])(
    "rejects %s",
    (decimal) => {
      expect(toCents(decimal).ok).toBe(false);
    },
  );
});

describe("checkWritableAmount (T133)", () => {
  it.each([0.01, 999999999999.99, 1, 1e2, 123.45, 0.3])("accepts %s as positive", (value) => {
    expect(checkWritableAmount(value, { positive: true })).toEqual({ ok: true });
  });
  it("accepts 0 only when not positive", () => {
    expect(checkWritableAmount(0, { positive: false })).toEqual({ ok: true });
    expect(checkWritableAmount(0, { positive: true })).toEqual({ ok: false, code: "invalid" });
  });
  it("exposes the limit in cents and decimal", () => {
    expect(MAX_AMOUNT_CENTS).toBe(99_999_999_999_999);
    expect(MAX_AMOUNT).toBe(999999999999.99);
    expect(MAX_AMOUNT * 100).toBe(MAX_AMOUNT_CENTS);
  });
  it.each([-0.01, -0, 1.001, 0.005, 1e-7, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "100", "1e2", null, undefined, {}, 10n])(
    "rejects %s as invalid", (value) => {
      expect(checkWritableAmount(value, { positive: true })).toEqual({ ok: false, code: "invalid" });
    });
  it.each([1000000000000, 999999999999.995, 1e21, 1e13])("rejects %s as exceeding the limit", (value) => {
    expect(checkWritableAmount(value, { positive: true })).toEqual({ ok: false, code: "exceeds_max" });
  });
});
