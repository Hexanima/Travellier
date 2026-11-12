import { describe, expect, it } from "vitest";
import { MAX_AMOUNT_CENTS, MAX_AMOUNT_TEXT, exceedsMaxAmount } from "./amount-limits.js";
import { parseAmount } from "./expense-draft.js";

describe("amount limits", () => {
  it("mirrors the backend limit", () => {
    expect(MAX_AMOUNT_CENTS).toBe(99_999_999_999_999n);
    expect(MAX_AMOUNT_TEXT).toBe("999.999.999.999,99");
    expect(exceedsMaxAmount(99_999_999_999_999n)).toBe(false);
    expect(exceedsMaxAmount(100_000_000_000_000n)).toBe(true);
  });
  it.each(["999999999999,99", "999999999999.99", "0,01"])("accepts %s", (raw) => {
    expect(parseAmount(raw).ok).toBe(true);
  });
  it.each(["1000000000000", "1000000000000,00", "99999999999999.99"])("rejects %s above the limit without rounding", (raw) => {
    expect(parseAmount(raw)).toEqual({ ok: false, code: "exceeds_max" });
  });
  it("keeps the precision error before the limit for a third decimal", () => {
    expect(parseAmount("999999999999,991")).toEqual({ ok: false, code: "precision" });
  });
  it.each(["0", "0,00", "-1", "-0,01", "1e5", "1.234,56"])("rejects %s as invalid", (raw) => {
    expect(parseAmount(raw)).toEqual({ ok: false, code: "invalid" });
  });
  it("requires a value", () => {
    expect(parseAmount("")).toEqual({ ok: false, code: "required" });
  });
  it("carries the exact amount at the edge", () => {
    expect(parseAmount("999999999999,99")).toEqual({ ok: true, cents: 99_999_999_999_999, amount: 999_999_999_999.99 });
  });
});
