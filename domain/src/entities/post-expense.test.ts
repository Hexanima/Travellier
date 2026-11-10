import { describe, expect, it } from "vitest";
import { toCents } from "../value-objects/money.js";
import { createObjectId, type ObjectId } from "../value-objects/object-id.js";
import { applyPostExpense, parsePostExpenseInput, type PostExpense } from "./post-expense.js";

const id = (n: number): ObjectId => {
  const parsed = createObjectId(n.toString(16).padStart(24, "0"));
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const [tripId, postId, newId] = [id(1), id(2), id(3)];
const createdAt = new Date("2026-10-04T12:00:00.000Z");
const stored: PostExpense = { id: id(9), tripId, postId, totalAmount: 100, currency: "ARS", breakdown: "agua 40", createdAt: new Date("2026-01-01T00:00:00.000Z") };
const legacy: PostExpense = { ...stored, currency: null, breakdown: null };
const issuesOf = (result: { ok: boolean; error?: { issues: readonly { field: string; code: string }[] } }) =>
  result.ok ? [] : result.error!.issues.map(({ field, code }) => `${field}:${code}`);
const apply = (existing: PostExpense | undefined, raw: unknown) => {
  const input = parsePostExpenseInput(raw);
  if (!input.ok) throw new Error(`parse failed: ${JSON.stringify(input.error.issues)}`);
  return applyPostExpense({ existing, input: input.value, tripId, postId, id: newId, createdAt });
};

describe("parsePostExpenseInput", () => {
  it.each([null, [], "100", 5, {}, undefined])("rejects %j as the expense", (raw) => {
    expect(issuesOf(parsePostExpenseInput(raw))).toEqual(["expense:invalid"]);
  });
  it.each(["payments", "shares", "paidBy", "id", "tripId", "createdAt"])("flags the key %s as unsupported", (key) => {
    expect(issuesOf(parsePostExpenseInput({ totalAmount: 10, [key]: [] }))).toEqual([`expense.${key}:unsupported`]);
  });
  it.each([0, -1, Number.NaN, Infinity, 10.005, "10", null, Number.MAX_SAFE_INTEGER + 1])("rejects totalAmount %j", (totalAmount) => {
    expect(issuesOf(parsePostExpenseInput({ totalAmount }))).toEqual(["expense.totalAmount:invalid"]);
  });
  it.each([0.1 + 0.2, 1e-7, 1e21, 1.5e-3, Number.MIN_VALUE])("rejects the edge totalAmount %j", (totalAmount) => {
    expect(parsePostExpenseInput({ totalAmount })).toMatchObject({ ok: false, error: { issues: [{ field: "expense.totalAmount", code: "invalid" }] } });
  });
  it.each([[1e2, 100], [0.01, 0.01], [123456789012.34, 123456789012.34], [70368744177663.98, 70368744177663.98], [70368744177663.99, 70368744177663.99]])(
    "accepts the edge totalAmount %j without rounding it", (totalAmount, expected) => {
      const parsed = parsePostExpenseInput({ totalAmount });
      expect(parsed).toEqual({ ok: true, value: { totalAmount: expected } });
      expect(Object.is((parsed as { value: { totalAmount: number } }).value.totalAmount, expected)).toBe(true);
      expect(String(expected)).toBe(String(totalAmount));
    });
  it.each([[70368744177663.98, 7036874417766398], [70368744177663.99, 7036874417766399], [123456789012.34, 12345678901234]])(
    "keeps the exact cents of %j (below 2^46 every 2-decimal amount is its own double)", (amount, cents) => {
      expect(toCents(amount)).toEqual({ ok: true, value: cents });
      const applied = apply(undefined, { totalAmount: amount, currency: "ARS" });
      expect(applied).toMatchObject({ ok: true, value: { expense: { totalAmount: amount } } });
      expect(toCents((applied as { value: { expense: { totalAmount: number } } }).value.expense.totalAmount)).toEqual({ ok: true, value: cents });
    });
  // LIMITE CONOCIDO de representacion: por encima de 2^46 (~7,04e13) los doubles distan 1/64, asi que dos importes
  // con 2 decimales pueden ser el mismo double: el JSON ya llega redondeado y el dominio no puede detectarlo.
  it("KNOWN LIMIT: 90071992547409.91 is the same double as 90071992547409.9 and yields 9007199254740990 cents", () => {
    expect(90071992547409.91 === 90071992547409.9).toBe(true);
    expect(String(90071992547409.91)).toBe("90071992547409.9");
    expect(toCents(90071992547409.91)).toEqual({ ok: true, value: 9007199254740990 });
    expect(parsePostExpenseInput({ totalAmount: 90071992547409.91 })).toEqual({ ok: true, value: { totalAmount: 90071992547409.9 } });
  });
  it("rejects the amounts whose cents exceed Number.MAX_SAFE_INTEGER", () => {
    expect(issuesOf(parsePostExpenseInput({ totalAmount: 90071992547409.92 }))).toEqual(["expense.totalAmount:invalid"]);
    expect(issuesOf(parsePostExpenseInput({ totalAmount: Number.MAX_SAFE_INTEGER / 100 }))).toEqual([]);
    expect(toCents(Number.MAX_SAFE_INTEGER).ok).toBe(false);
  });
  it.each(["BRL", "ars", 1, null])("rejects currency %j", (currency) => {
    expect(issuesOf(parsePostExpenseInput({ currency }))).toEqual(["expense.currency:invalid"]);
  });
  it.each([1, true, [], {}])("rejects breakdown %j", (breakdown) => {
    expect(issuesOf(parsePostExpenseInput({ breakdown }))).toEqual(["expense.breakdown:invalid"]);
  });
  it("reports every problem together and accepts a valid partial input", () => {
    expect(issuesOf(parsePostExpenseInput({ totalAmount: 0, currency: "BRL", payments: [] })).sort())
      .toEqual(["expense.currency:invalid", "expense.payments:unsupported", "expense.totalAmount:invalid"]);
    expect(parsePostExpenseInput({ currency: "EUR" })).toEqual({ ok: true, value: { currency: "EUR" } });
    expect(parsePostExpenseInput({ totalAmount: 12.5, currency: "USD", breakdown: null }))
      .toEqual({ ok: true, value: { totalAmount: 12.5, currency: "USD", breakdown: null } });
  });
});

describe("applyPostExpense", () => {
  it("inserts a new expense with the given id and creation date", () => {
    expect(apply(undefined, { totalAmount: 8000.5, currency: "EUR", breakdown: "entrada 8000" })).toEqual({ ok: true,
      value: { mode: "insert", changed: ["totalAmount", "currency", "breakdown"],
        expense: { id: newId, tripId, postId, totalAmount: 8000.5, currency: "EUR", breakdown: "entrada 8000", createdAt } } });
  });
  it("an insert without breakdown stores null", () => {
    expect(apply(undefined, { totalAmount: 5, currency: "USD" })).toMatchObject({ ok: true, value: { mode: "insert", expense: { breakdown: null } } });
  });
  it.each([[{ currency: "ARS" }, ["expense.totalAmount:required"]], [{ totalAmount: 10 }, ["expense.currency:required"]],
    [{ breakdown: "x" }, ["expense.totalAmount:required", "expense.currency:required"]]])("an insert needs total and currency: %j", (raw, issues) => {
    expect(issuesOf(apply(undefined, raw) as never).sort()).toEqual([...issues].sort());
  });
  it("an update merges only the present fields and keeps id and createdAt", () => {
    expect(apply(stored, { totalAmount: 250 })).toEqual({ ok: true, value: { mode: "update", changed: ["totalAmount"],
      expense: { ...stored, totalAmount: 250 } } });
    expect(apply(stored, { currency: "USD" })).toMatchObject({ ok: true, value: { changed: ["currency"], expense: { ...stored, currency: "USD" } } });
    expect(apply(stored, { breakdown: "otro" })).toMatchObject({ ok: true, value: { changed: ["breakdown"], expense: { ...stored, breakdown: "otro" } } });
  });
  it("breakdown null clears it and blank text becomes null; other text is kept as is", () => {
    expect(apply(stored, { breakdown: null })).toMatchObject({ ok: true, value: { expense: { breakdown: null } } });
    expect(apply(stored, { breakdown: "  \n " })).toMatchObject({ ok: true, value: { expense: { breakdown: null } } });
    expect(apply(stored, { breakdown: "" })).toMatchObject({ ok: true, value: { expense: { breakdown: null } } });
    expect(apply(stored, { breakdown: "  agua 5000 " })).toMatchObject({ ok: true, value: { expense: { breakdown: "  agua 5000 " } } });
  });
  it("completes a legacy expense without inventing a currency", () => {
    expect(apply(legacy, { currency: "EUR" })).toEqual({ ok: true, value: { mode: "update", changed: ["currency"],
      expense: { ...legacy, currency: "EUR" } } });
    expect(issuesOf(apply(legacy, { breakdown: "x" }) as never)).toEqual(["expense.currency:required"]);
    expect(issuesOf(apply(legacy, { totalAmount: 20 }) as never)).toEqual(["expense.currency:required"]);
  });
  it("rejects an invalid stored total once merged", () => {
    expect(issuesOf(apply({ ...legacy, totalAmount: 0 }, { currency: "ARS" }) as never)).toEqual(["expense.totalAmount:invalid"]);
    expect(issuesOf(apply({ ...legacy, totalAmount: 10.005 }, { currency: "ARS" }) as never)).toEqual(["expense.totalAmount:invalid"]);
  });
});
