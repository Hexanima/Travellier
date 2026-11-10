import { describe, expect, it } from "vitest";
import { CURRENCIES, createCurrency, toCents } from "./money.js";

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
