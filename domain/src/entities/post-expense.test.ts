import { describe, expect, it } from "vitest";
import { toCents } from "../value-objects/money.js";
import { createObjectId, type ObjectId } from "../value-objects/object-id.js";
import type { ExpensePayment, ExpenseShare } from "./expense.js";
import { adaptLegacyPaidBy, hasLegacyPaymentsGap } from "./expense-legacy.js";
import { applyPostExpense, describePostExpense, parsePostExpenseInput, type PostExpense } from "./post-expense.js";

const id = (n: number): ObjectId => {
  const parsed = createObjectId(n.toString(16).padStart(24, "0"));
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const [tripId, postId, newId] = [id(1), id(2), id(3)];
const createdAt = new Date("2026-10-04T12:00:00.000Z");
const stored: PostExpense = { id: id(9), tripId, postId, totalAmount: 100, currency: "ARS", breakdown: "agua 40", payments: [], shares: [],
  createdAt: new Date("2026-01-01T00:00:00.000Z") };
const legacy: PostExpense = { ...stored, currency: null, breakdown: null };
const [ana, beto, caro, dani] = [id(11), id(12), id(13), id(14)];
const issuesOf = (result: { ok: boolean; error?: { issues: readonly { field: string; code: string }[] } }) =>
  result.ok ? [] : result.error!.issues.map(({ field, code }) => `${field}:${code}`);
/** `members` are the current members among the referenced users (the use case reads them in the same snapshot). */
const apply = (existing: PostExpense | undefined, raw: unknown, members: ObjectId[] = [ana, beto, caro, dani]) => {
  const input = parsePostExpenseInput(raw);
  if (!input.ok) throw new Error(`parse failed: ${JSON.stringify(input.error.issues)}`);
  return applyPostExpense({ existing, input: input.value, tripId, postId, id: newId, createdAt, memberIds: members });
};
const pay = (userId: ObjectId, unit: "amount" | "percent", value: number): ExpensePayment => ({ userId, unit, value });
const share = (userId: ObjectId, unit: ExpenseShare["unit"], value: number | null = null): ExpenseShare => ({ userId, unit, value });

describe("parsePostExpenseInput", () => {
  it.each([null, [], "100", 5, {}, undefined])("rejects %j as the expense", (raw) => {
    expect(issuesOf(parsePostExpenseInput(raw))).toEqual(["expense:invalid"]);
  });
  it.each(["paidBy", "id", "tripId", "createdAt", "completeness", "formerMemberIds"])("flags the key %s as unsupported", (key) => {
    expect(issuesOf(parsePostExpenseInput({ totalAmount: 10, [key]: [] }))).toEqual([`expense.${key}:unsupported`]);
  });
  it("accepts payments and shares (they are no longer unsupported) and keeps an explicit empty list as an empty list", () => {
    const payments = [{ userId: ana, unit: "percent", value: 100 }], shares = [{ userId: ana, unit: "remainder", value: null }];
    expect(parsePostExpenseInput({ payments, shares })).toEqual({ ok: true, value: { payments, shares } });
    expect(parsePostExpenseInput({ payments: [], shares: [] })).toEqual({ ok: true, value: { payments: [], shares: [] } });
  });
  it.each([null, "x", 5, {}, true])("rejects payments %j as invalid: null is not the same as absent", (rows) => {
    expect(issuesOf(parsePostExpenseInput({ payments: rows }))).toEqual(["expense.payments:invalid"]);
    expect(issuesOf(parsePostExpenseInput({ shares: rows }))).toEqual(["expense.shares:invalid"]);
  });
  it("flags unknown keys inside a row with the row path", () => {
    expect(issuesOf(parsePostExpenseInput({ payments: [{ userId: ana, unit: "amount", value: 1, extra: 1 }] }))).toEqual(["expense.payments[0].extra:unsupported"]);
    expect(issuesOf(parsePostExpenseInput({ shares: [{ userId: ana, unit: "excluded", value: null }, { userId: beto, unit: "amount", value: 1, paidBy: ana }] })))
      .toEqual(["expense.shares[1].paidBy:unsupported"]);
  });
  it.each([0, -1, Number.NaN, Infinity, 10.005, "10", null])("rejects totalAmount %j", (totalAmount) => {
    expect(issuesOf(parsePostExpenseInput({ totalAmount }))).toEqual(["expense.totalAmount:invalid"]);
  });
  it.each([0.1 + 0.2, 1e-7, 1.5e-3, Number.MIN_VALUE])("rejects the edge totalAmount %j", (totalAmount) => {
    expect(parsePostExpenseInput({ totalAmount })).toMatchObject({ ok: false, error: { issues: [{ field: "expense.totalAmount", code: "invalid" }] } });
  });
  it.each([[1e2, 100], [0.01, 0.01], [123456789012.34, 123456789012.34], [999999999999.99, 999999999999.99]])(
    "accepts the edge totalAmount %j without rounding it", (totalAmount, expected) => {
      const parsed = parsePostExpenseInput({ totalAmount });
      expect(parsed).toEqual({ ok: true, value: { totalAmount: expected } });
      expect(Object.is((parsed as { value: { totalAmount: number } }).value.totalAmount, expected)).toBe(true);
      expect(String(expected)).toBe(String(totalAmount));
    });
  it.each([[999999999999.98, 99999999999998], [999999999999.99, 99999999999999], [123456789012.34, 12345678901234]])(
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
    expect(issuesOf(parsePostExpenseInput({ totalAmount: 90071992547409.91 }))).toEqual(["expense.totalAmount:exceeds_max"]);
  });
  it("rejects the amounts whose cents exceed Number.MAX_SAFE_INTEGER", () => {
    expect(issuesOf(parsePostExpenseInput({ totalAmount: 90071992547409.92 }))).toEqual(["expense.totalAmount:exceeds_max"]);
    expect(issuesOf(parsePostExpenseInput({ totalAmount: Number.MAX_SAFE_INTEGER / 100 }))).toEqual(["expense.totalAmount:exceeds_max"]);
    expect(toCents(Number.MAX_SAFE_INTEGER).ok).toBe(false);
  });
  it.each(["BRL", "ars", 1, null])("rejects currency %j", (currency) => {
    expect(issuesOf(parsePostExpenseInput({ currency }))).toEqual(["expense.currency:invalid"]);
  });
  it.each([1, true, [], {}])("rejects breakdown %j", (breakdown) => {
    expect(issuesOf(parsePostExpenseInput({ breakdown }))).toEqual(["expense.breakdown:invalid"]);
  });
  it("reports every problem together and accepts a valid partial input", () => {
    expect(issuesOf(parsePostExpenseInput({ totalAmount: 0, currency: "BRL", paidBy: ana })).sort())
      .toEqual(["expense.currency:invalid", "expense.paidBy:unsupported", "expense.totalAmount:invalid"]);
    expect(parsePostExpenseInput({ currency: "EUR" })).toEqual({ ok: true, value: { currency: "EUR" } });
    expect(parsePostExpenseInput({ totalAmount: 12.5, currency: "USD", breakdown: null }))
      .toEqual({ ok: true, value: { totalAmount: 12.5, currency: "USD", breakdown: null } });
  });
});

describe("applyPostExpense", () => {
  it("inserts a new expense with the given id and creation date", () => {
    expect(apply(undefined, { totalAmount: 8000.5, currency: "EUR", breakdown: "entrada 8000" })).toEqual({ ok: true,
      value: { mode: "insert", changed: ["totalAmount", "currency", "breakdown", "payments", "shares"],
        expense: { id: newId, tripId, postId, totalAmount: 8000.5, currency: "EUR", breakdown: "entrada 8000", payments: [], shares: [], createdAt } } });
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

describe("applyPostExpense: payments and shares (T80)", () => {
  const withRows = (payments: ExpensePayment[], shares: ExpenseShare[]): PostExpense => ({ ...stored, payments, shares });
  const agreed = withRows([pay(ana, "amount", 60), pay(beto, "percent", 40)], [share(ana, "percent", 50), share(beto, "remainder")]);

  it("an absent key keeps what is stored and an empty list clears it explicitly", () => {
    expect(apply(agreed, { breakdown: "x" })).toMatchObject({ ok: true, value: { changed: ["breakdown"], expense: { payments: agreed.payments, shares: agreed.shares } } });
    expect(apply(agreed, { payments: [] })).toMatchObject({ ok: true, value: { changed: ["payments"], expense: { payments: [], shares: agreed.shares } } });
    expect(apply(agreed, { shares: [] })).toMatchObject({ ok: true, value: { changed: ["shares"], expense: { payments: agreed.payments, shares: [] } } });
  });
  it("replaces the whole list of the key present and normalizes the rows", () => {
    const upper = ana.toUpperCase() as ObjectId;
    const applied = apply(agreed, { shares: [{ userId: upper, unit: "excluded", value: null }] });
    expect(applied).toMatchObject({ ok: true, value: { changed: ["shares"], expense: { payments: agreed.payments, shares: [share(ana, "excluded")] } } });
  });
  it("accepts several payments of the same user and every share unit", () => {
    const payments = [pay(ana, "amount", 10), pay(ana, "amount", 20), pay(ana, "percent", 5)];
    const shares = [share(ana, "amount", 10), share(beto, "percent", 20), share(caro, "remainder"), share(dani, "excluded")];
    expect(apply(stored, { payments, shares })).toMatchObject({ ok: true, value: { expense: { payments, shares } } });
  });
  it("a total change keeps both lists: fixed amounts are not recalculated as percentages and percentages are kept as percentages", () => {
    const applied = apply(agreed, { totalAmount: 250 });
    expect(applied).toMatchObject({ ok: true, value: { changed: ["totalAmount"] } });
    expect((applied as { value: { expense: PostExpense } }).value.expense.payments).toEqual([pay(ana, "amount", 60), pay(beto, "percent", 40)]);
    expect((applied as { value: { expense: PostExpense } }).value.expense.shares).toEqual([share(ana, "percent", 50), share(beto, "remainder")]);
  });
  it("a total that leaves a fixed amount above it is rejected, and the same save can resend adjusted rows", () => {
    expect(issuesOf(apply(agreed, { totalAmount: 50 }) as never)).toEqual(["expense.payments:exceeds_total"]);
    expect(apply(agreed, { totalAmount: 50, payments: [pay(ana, "amount", 30), pay(beto, "percent", 40)] })).toMatchObject({ ok: true });
  });
  it.each([
    ["a negative value", { payments: [pay(ana, "amount", -1)] }, ["expense.payments[0].value:invalid_value"]],
    ["a percent above 100", { payments: [pay(ana, "amount", 1), pay(beto, "percent", 101)] }, ["expense.payments[1].value:invalid_value"]],
    ["a share repeated for a user", { shares: [share(ana, "remainder"), share(beto, "amount", 1), share(beto, "excluded")] }, ["expense.shares[2].userId:duplicate_user"]],
    ["an unknown unit", { payments: [{ userId: ana, unit: "remainder", value: null }] }, ["expense.payments[0].unit:invalid_unit"]],
    ["an invalid user", { shares: [{ userId: "zz", unit: "excluded", value: null }] }, ["expense.shares[0].userId:invalid_user"]],
    ["payments above the total", { payments: [pay(ana, "amount", 60), pay(beto, "amount", 60)] }, ["expense.payments:exceeds_total"]],
    ["percent payments above 100", { payments: [pay(ana, "percent", 60), pay(beto, "percent", 60)] }, ["expense.payments:exceeds_total"]],
    ["shares above the total", { shares: [share(ana, "amount", 101)] }, ["expense.shares:exceeds_total"]],
  ])("rejects %s with the field and code of the domain", (_name, raw, expected) => {
    expect(issuesOf(apply(stored, raw) as never)).toEqual(expected);
  });
  it("saves an incomplete expense: no shares, payments not covering the total", () => {
    expect(apply(stored, { payments: [pay(ana, "amount", 10)] })).toMatchObject({ ok: true, value: { expense: { payments: [pay(ana, "amount", 10)], shares: [] } } });
    expect(apply(stored, { shares: [share(ana, "amount", 10)] })).toMatchObject({ ok: true, value: { expense: { payments: [], shares: [share(ana, "amount", 10)] } } });
  });
  it("keeps the T79 codes for total and currency", () => {
    expect(issuesOf(apply({ ...stored, totalAmount: 0 }, { payments: [] }) as never)).toEqual(["expense.totalAmount:invalid"]);
    expect(issuesOf(apply(undefined, { totalAmount: 5, payments: [pay(ana, "amount", 1)] }) as never)).toEqual(["expense.currency:required"]);
  });
  it("does not revalidate stored rows when the save only changes breakdown or currency, but does when it carries total, payments or shares", () => {
    const overdrawn = withRows([pay(ana, "amount", 500)], []);
    expect(apply(overdrawn, { breakdown: "x" })).toMatchObject({ ok: true });
    expect(apply(overdrawn, { currency: "USD" })).toMatchObject({ ok: true });
    expect(issuesOf(apply(overdrawn, { totalAmount: 100 }) as never)).toEqual(["expense.payments:exceeds_total"]);
    expect(issuesOf(apply(overdrawn, { shares: [share(ana, "excluded")] }) as never)).toEqual(["expense.payments:exceeds_total"]);
  });
  it("never invents a currency for a legacy expense with payments", () => {
    const legacyPaid: PostExpense = { ...legacy, payments: [pay(ana, "percent", 100)] };
    expect(issuesOf(apply(legacyPaid, { shares: [share(ana, "remainder")] }) as never)).toEqual(["expense.currency:required"]);
    expect(apply(legacyPaid, { currency: "USD" })).toMatchObject({ ok: true, value: { expense: { currency: "USD", payments: legacyPaid.payments, shares: [] } } });
  });

  describe("membership of the referenced users", () => {
    it("a new row of a user that is not a current member is rejected with the row path", () => {
      expect(issuesOf(apply(stored, { payments: [pay(ana, "amount", 1), pay(caro, "amount", 1)] }, [ana]) as never)).toEqual(["expense.payments[1].userId:not_member"]);
      expect(issuesOf(apply(stored, { shares: [share(dani, "excluded")] }, []) as never)).toEqual(["expense.shares[0].userId:not_member"]);
    });
    it("a row whose user is already in the stored payments or shares is accepted even if the user left (historic identity)", () => {
      expect(apply(agreed, { payments: [pay(ana, "amount", 10)], shares: [share(beto, "remainder"), share(ana, "amount", 5)] }, [])).toMatchObject({ ok: true });
      // the user of a payment may appear in shares and the other way round: the stored expense already names them
      expect(apply(agreed, { shares: [share(ana, "excluded")] }, [])).toMatchObject({ ok: true });
    });
    it("a legacy payer derived from paidBy counts as already stored", () => {
      const derived: PostExpense = { ...legacy, payments: adaptLegacyPaidBy(dani) };
      expect(apply(derived, { currency: "ARS", shares: [share(dani, "remainder")] }, [])).toMatchObject({ ok: true });
      expect(issuesOf(apply(derived, { currency: "ARS", shares: [share(caro, "remainder")] }, []) as never)).toEqual(["expense.shares[0].userId:not_member"]);
    });
    it("a stored row of a former member does not need to be resent and is not checked when untouched", () => {
      expect(apply(agreed, { breakdown: "x" }, [])).toMatchObject({ ok: true });
      expect(apply(agreed, { totalAmount: 200 }, [])).toMatchObject({ ok: true });
    });
    it("reports the membership problem together with the rule problems of the same save", () => {
      expect(issuesOf(apply(stored, { shares: [share(ana, "amount", 1), share(ana, "excluded")] }, []) as never).sort())
        .toEqual(["expense.shares[0].userId:not_member", "expense.shares[1].userId:duplicate_user", "expense.shares[1].userId:not_member"]);
    });
  });
});

describe("adaptLegacyPaidBy", () => {
  it("adapts a valid paidBy to one payment of 100 percent, normalizing the id, whatever its membership", () => {
    expect(adaptLegacyPaidBy(ana)).toEqual([{ userId: ana, unit: "percent", value: 100 }]);
    expect(adaptLegacyPaidBy(ana.toUpperCase())).toEqual([{ userId: ana, unit: "percent", value: 100 }]);
  });
  it.each([null, undefined, "", "zz", 5, {}, [], ana.slice(1)])("yields no payment for the unknown payer %j", (paidBy) => {
    expect(adaptLegacyPaidBy(paidBy)).toEqual([]);
  });
  it("only a missing or null payments field needs the adaptation: an explicit list, even empty, is the truth", () => {
    expect(hasLegacyPaymentsGap(undefined)).toBe(true);
    expect(hasLegacyPaymentsGap(null)).toBe(true);
    expect(hasLegacyPaymentsGap([])).toBe(false);
    expect(hasLegacyPaymentsGap([pay(ana, "amount", 1)])).toBe(false);
  });
});

describe("describePostExpense", () => {
  const view = (expense: PostExpense, members: ObjectId[]) => describePostExpense(expense, members);
  it("reports a complete expense with no reasons and no former members", () => {
    const complete: PostExpense = { ...stored, payments: [pay(ana, "percent", 100)], shares: [share(ana, "percent", 50), share(beto, "remainder")] };
    expect(view(complete, [ana, beto])).toEqual({ ...complete, completeness: { status: "complete", reasons: [] }, formerMemberIds: [] });
  });
  it("a legacy payer without currency or shares is incomplete and names the missing parts, never inventing them", () => {
    const adapted: PostExpense = { ...legacy, payments: adaptLegacyPaidBy(dani) };
    expect(view(adapted, [])).toEqual({ ...adapted, completeness: { status: "incomplete", reasons: ["missing_currency", "missing_shares"] }, formerMemberIds: [dani] });
  });
  it("lists missing payments, shares and coverage", () => {
    expect(view(stored, []).completeness).toEqual({ status: "incomplete", reasons: ["missing_payments", "missing_shares"] });
    const partial: PostExpense = { ...stored, payments: [pay(ana, "amount", 10)], shares: [share(ana, "amount", 10)] };
    expect(view(partial, [ana]).completeness).toEqual({ status: "incomplete", reasons: ["payments_not_covering_total", "shares_not_covering_total"] });
  });
  it("lists the users of payments and shares that are not current members once, in order", () => {
    const rows: PostExpense = { ...stored, payments: [pay(caro, "amount", 10), pay(ana, "amount", 10), pay(caro, "amount", 5)],
      shares: [share(dani, "excluded"), share(caro, "amount", 1), share(beto, "remainder")] };
    expect(view(rows, [ana, beto]).formerMemberIds).toEqual([caro, dani]);
  });
  it("is derived on every call and is not a field of the stored expense", () => {
    const described = view(stored, []);
    expect(Object.keys(stored)).not.toContain("completeness");
    expect(Object.keys(described)).toEqual(expect.arrayContaining(["completeness", "formerMemberIds"]));
  });
});

describe("breakdown limit (T122)", () => {
  it("accepts 2000 code points, rejects 2001 and never trims or cuts", () => {
    expect(issuesOf(parsePostExpenseInput({ breakdown: "😀".repeat(2000) }))).toEqual([]);
    expect(issuesOf(parsePostExpenseInput({ breakdown: "😀".repeat(2001) }))).toEqual(["expense.breakdown:too_long"]);
    expect(issuesOf(parsePostExpenseInput({ breakdown: "a".repeat(2000) + " " }))).toEqual(["expense.breakdown:too_long"]);
    const text = "x".repeat(2000);
    expect(parsePostExpenseInput({ breakdown: text })).toEqual({ ok: true, value: { breakdown: text } });
    expect(parsePostExpenseInput({ breakdown: null })).toEqual({ ok: true, value: { breakdown: null } });
  });
});

describe("amount limits (T133)", () => {
  const MAX = 999999999999.99;
  it("accepts a total at the limit and rejects one cent more with exceeds_max", () => {
    expect(parsePostExpenseInput({ totalAmount: MAX }).ok).toBe(true);
    expect(issuesOf(parsePostExpenseInput({ totalAmount: 1000000000000 }))).toEqual(["expense.totalAmount:exceeds_max"]);
    expect(issuesOf(parsePostExpenseInput({ totalAmount: 999999999999.995 }))).toEqual(["expense.totalAmount:exceeds_max"]);
    expect(issuesOf(parsePostExpenseInput({ totalAmount: 1e21 }))).toEqual(["expense.totalAmount:exceeds_max"]);
    expect(issuesOf(parsePostExpenseInput({ totalAmount: Number.MAX_SAFE_INTEGER + 1 }))).toEqual(["expense.totalAmount:exceeds_max"]);
  });
  it.each([0, -1, 1.001, "100", Number.NaN, Number.POSITIVE_INFINITY])("rejects the total %j as invalid", (value) => {
    expect(issuesOf(parsePostExpenseInput({ totalAmount: value }))).toEqual(["expense.totalAmount:invalid"]);
  });
  it("limits fixed rows by amount with the row path, accepts 0 and ignores percentages", () => {
    expect(parsePostExpenseInput({ payments: [pay(ana, "amount", MAX)], shares: [share(ana, "amount", 0)] }).ok).toBe(true);
    expect(issuesOf(parsePostExpenseInput({ payments: [pay(ana, "amount", 1000000000000)] }))).toEqual(["expense.payments[0].value:exceeds_max"]);
    expect(issuesOf(parsePostExpenseInput({ shares: [share(ana, "amount", 1), share(beto, "amount", 1e13)] }))).toEqual(["expense.shares[1].value:exceeds_max"]);
    expect(issuesOf(parsePostExpenseInput({ shares: [share(ana, "amount", 1.001)] }))).toEqual(["expense.shares[0].value:invalid"]);
    expect(parsePostExpenseInput({ payments: [pay(ana, "percent", 100)], shares: [share(ana, "percent", 33.333)] }).ok).toBe(true);
  });
  it("sums rows and total at the limit without overflow", () => {
    const plan = apply(undefined, { totalAmount: MAX, currency: "ARS", payments: [pay(ana, "amount", MAX)], shares: [share(ana, "amount", 500000000000), share(beto, "amount", 499999999999.99)] });
    expect(plan.ok).toBe(true);
  });
  it("leaves reads and unrelated patches over a stored total above the limit untouched", () => {
    const big: PostExpense = { ...stored, totalAmount: 1e13, payments: [pay(ana, "amount", 1e13)], shares: [share(ana, "amount", 1e13)] };
    expect(describePostExpense(big, [ana]).completeness.status).toBe("complete");
    expect(apply(big, { breakdown: "nota" }).ok).toBe(true);
    expect(apply(big, { payments: [pay(beto, "percent", 100)] }).ok).toBe(true);
  });
});
