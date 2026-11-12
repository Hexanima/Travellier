import { resolveExpense, toCents, validateExpenseRules, type ExpenseIncompleteReason, type ExpensePayment, type ExpenseShare } from "app-domain";
import { parseAmount, validateExpense, type ExpenseCurrency, type ExpenseDraft } from "./expense-draft.js";
import { MAX_AMOUNT_TEXT } from "./amount-limits.js";
import { formatCents } from "./expense-format.js";
import type { PhotoPeople } from "./photo-people.js";
import type { ExpensePaymentRow, ExpenseShareRow, SavedExpenseView } from "./trip-post-api.js";

/**
 * Editor rows. `key` is a stable id of the row (not the person: payments may repeat one) used by the form and to map server errors;
 * it never travels. `value` is the text typed (`""` for `remainder` and `excluded`). `null` lists mean «untouched»: the stored one stays.
 */
export type PaymentRow = { key: string; userId: string; unit: "amount" | "percent"; value: string };
export type ShareUnit = "amount" | "percent" | "remainder" | "excluded";
export type ShareRow = { key: string; userId: string; unit: ShareUnit; value: string };
export type SplitDraft = { payments: PaymentRow[] | null; shares: ShareRow[] | null };
export type WorkingSplit = { payments: PaymentRow[]; shares: ShareRow[] };
export type SplitTotals = { totalAmount: number; totalCents: number; currency: ExpenseCurrency };
export type RowErrors = Record<string, string>;
export type ListErrors = { payments?: string; shares?: string };

export const emptySplit = (): SplitDraft => ({ payments: null, shares: null });
export const blockedMessage = "Cargá primero importe y moneda del gasto.";
export const percentNote = "Los porcentajes se recalculan sobre el total mostrado; los montos fijos no cambian.";

let counter = 0;
export const newRowKey = (): string => `n${++counter}`;

// ---- value parsing (exact, no floating point) ----

export type RowValue = { ok: true; value: number } | { ok: false; code: "required" | "invalid" | "precision" | "exceeds_max" | "range" };
/** Amounts and percentages share the text rules of the expense amount; a percentage is at most 100 and zero is only for rows already saved. */
export const parseRowValue = (unit: "amount" | "percent", text: string, allowZero: boolean): RowValue => {
  const parsed = parseAmount(text, { allowZero });
  if (!parsed.ok) return { ok: false, code: unit === "percent" && parsed.code === "exceeds_max" ? "range" : parsed.code };
  if (unit === "percent" && parsed.cents > 10000) return { ok: false, code: "range" };
  return { ok: true, value: parsed.amount };
};
const valueMessages = { required: "Ingresá el valor.", invalid: "Ingresá un número válido mayor a cero, por ejemplo 12,50.",
  precision: "Admite hasta 2 decimales.", exceeds_max: `El importe no puede superar ${MAX_AMOUNT_TEXT}. No lo redondeamos por vos.`, range: "El porcentaje no puede superar 100." } as const;
const duplicateMessage = "Esta persona ya tiene una parte. Quitá la fila repetida.";
const isSaved = (key: string) => key.startsWith("saved-");

const valueText = (unit: string, value: number | null): string => {
  if (value === null) return "";
  if (unit === "percent") return String(value).replace(".", ",");
  const cents = toCents(value);
  if (!cents.ok) return String(value).replace(".", ",");
  return cents.value % 100 === 0 ? String(cents.value / 100) : `${Math.floor(cents.value / 100)},${String(cents.value % 100).padStart(2, "0")}`;
};

/** The stored lists as editor rows, with keys that are stable between reads. */
export const savedSplit = (saved: SavedExpenseView | undefined): WorkingSplit => ({
  payments: (saved?.payments ?? []).map((row, index) => ({ key: `saved-p${index}`, userId: row.userId, unit: row.unit, value: valueText(row.unit, row.value) })),
  shares: (saved?.shares ?? []).map((row, index) => ({ key: `saved-s${index}`, userId: row.userId, unit: row.unit, value: valueText(row.unit, row.value) })) });

// ---- totals ----

/** The total the split is checked against: the typed expense if the person edited it, otherwise the stored one. Without amount and currency nothing can be configured. */
export const splitTotals = (typed: ExpenseDraft | null, saved: SavedExpenseView | undefined): { ok: true; totals: SplitTotals } | { ok: false } => {
  if (typed !== null) {
    const checked = validateExpense(typed);
    return checked.ok ? { ok: true, totals: { totalAmount: checked.value.totalAmount, totalCents: checked.cents, currency: checked.value.currency } } : { ok: false };
  }
  if (!saved || saved.currency === null) return { ok: false };
  const cents = toCents(saved.totalAmount);
  return cents.ok && cents.value > 0 ? { ok: true, totals: { totalAmount: saved.totalAmount, totalCents: cents.value, currency: saved.currency } } : { ok: false };
};

// ---- validation and summary ----

export type Summary = { totalCents: number; coveredCents: number; missingCents: number; excessCents: number };
export type SectionCheck<Row> = { valid: boolean; rowErrors: RowErrors; listError?: string; summary?: Summary; rows?: Row[]; remainderCents?: Record<string, number> };
export type SplitCheck = { valid: boolean; payments: SectionCheck<ExpensePayment>; shares: SectionCheck<ExpenseShare>; incomplete: { payments?: string[]; shares?: string[] } };

const hundredths = (text: string): bigint => {
  const parsed = parseAmount(text, { allowZero: true });
  return parsed.ok ? BigInt(parsed.cents) : 0n;
};
const toSummary = (totalCents: number, covered: bigint): Summary => {
  const total = BigInt(totalCents);
  return { totalCents, coveredCents: Number(covered), missingCents: covered < total ? Number(total - covered) : 0, excessCents: covered > total ? Number(covered - total) : 0 };
};
/** Own estimate (rows rounded one by one): only for sections the shared rules cannot resolve, such as the ones still missing data. */
const summarize = (totals: SplitTotals, rows: readonly { unit: string; value: string }[]): Summary => {
  let covered = 0n;
  for (const row of rows) {
    if (row.unit === "remainder" || row.unit === "excluded") continue;
    const h = hundredths(row.value);
    covered += row.unit === "amount" ? h : (h * BigInt(totals.totalCents) + 5000n) / 10000n;
  }
  return toSummary(totals.totalCents, covered);
};
/** Cents per row already resolved by the shared rules (rest and percentage residue included): what is covered is their sum. */
const resolvedSummary = (totalCents: number, resolved: readonly { cents: number }[]): Summary =>
  toSummary(totalCents, resolved.reduce((sum, row) => sum + BigInt(row.cents), 0n));

const parseRows = (rows: readonly (PaymentRow | ShareRow)[], isShares: boolean): { rows: { userId: string; unit: string; value: number | null }[]; errors: RowErrors } => {
  const errors: RowErrors = {}, parsed: { userId: string; unit: string; value: number | null }[] = [], seen = new Set<string>();
  for (const row of rows) {
    if (isShares) {
      if (seen.has(row.userId)) errors[row.key] = duplicateMessage;
      seen.add(row.userId);
    }
    if (row.unit === "remainder" || row.unit === "excluded") { parsed.push({ userId: row.userId, unit: row.unit, value: null }); continue; }
    const value = parseRowValue(row.unit, row.value, isSaved(row.key));
    if (value.ok) parsed.push({ userId: row.userId, unit: row.unit, value: value.value });
    else errors[row.key] ??= valueMessages[value.code];
  }
  return { rows: parsed, errors };
};

const reasonMessages: Record<ExpenseIncompleteReason, { section: "payments" | "shares" | "both"; text: string; coverage?: true }> = {
  missing_currency: { section: "both", text: "Falta la moneda." },
  missing_payments: { section: "payments", text: "Falta registrar quién pagó." },
  payments_not_covering_total: { section: "payments", text: "Los pagos todavía no cubren el total.", coverage: true },
  missing_shares: { section: "shares", text: "Falta definir el reparto." },
  shares_not_covering_total: { section: "shares", text: "El reparto todavía no cubre el total.", coverage: true },
  no_remainder_participant: { section: "shares", text: "Nadie participa del reparto: agregá a alguien con «Resto»." },
  invalid_rules: { section: "both", text: "Revisá los valores." },
};

/**
 * Checks both sections of the working split against the total. Each section is judged on its own (an invalid one does not invalidate the other).
 * The summary is informational; what is complete or incomplete comes from the shared rules (`resolveExpense`), and an incomplete split is accepted.
 */
export const checkSplit = (totals: SplitTotals, split: WorkingSplit): SplitCheck => {
  const base = { totalAmount: totals.totalAmount, currency: totals.currency };
  const section = <Row,>(rows: readonly (PaymentRow | ShareRow)[], isShares: boolean): SectionCheck<Row> => {
    const { rows: parsed, errors } = parseRows(rows, isShares);
    const summary = summarize(totals, rows.filter((row) => !errors[row.key]));
    if (Object.keys(errors).length > 0) return { valid: false, rowErrors: errors, summary };
    const rules = validateExpenseRules({ ...base, [isShares ? "shares" : "payments"]: parsed });
    if (!rules.ok) {
      const excess = summary.excessCents > 0 ? `Sobran ${formatCents(summary.excessCents, totals.currency)}.` : "Los valores superan el total.";
      return { valid: false, rowErrors: errors, listError: excess, summary };
    }
    const own = resolveExpense({ ...base, [isShares ? "shares" : "payments"]: parsed });
    const resolved = isShares ? own.shares : own.payments;
    return { valid: true, rowErrors: errors, summary: resolved ? resolvedSummary(totals.totalCents, resolved) : summary, rows: parsed as Row[] };
  };
  const payments = section<ExpensePayment>(split.payments, false), shares = section<ExpenseShare>(split.shares, true);
  const resolution = resolveExpense({ ...base, payments: payments.rows ?? [], shares: shares.rows ?? [] });
  const incomplete: SplitCheck["incomplete"] = {};
  if (resolution.status === "incomplete") {
    for (const reason of resolution.reasons) {
      const info = reasonMessages[reason];
      for (const name of ["payments", "shares"] as const) {
        if (info.section !== "both" && info.section !== name) continue;
        const check = name === "payments" ? payments : shares;
        // A section with errors says so itself; a coverage reason is redundant with the «Faltan» line unless the summary shows nothing missing.
        if (!check.valid || (info.coverage && (check.summary?.missingCents ?? 0) > 0)) continue;
        (incomplete[name] ??= []).push(info.text);
      }
    }
  }
  // Rest per person (the same split as the shared rules), only when the shares are valid on their own.
  if (shares.valid && shares.rows?.some((row) => row.unit === "remainder")) {
    const only = resolveExpense({ ...base, shares: shares.rows });
    if (only.shares) shares.remainderCents = Object.fromEntries(split.shares.flatMap((row, index) => row.unit === "remainder" ? [[row.key, only.shares![index]!.cents]] : []));
  }
  return { valid: payments.valid && shares.valid, payments, shares, incomplete };
};

// ---- proposal and inclusion ----

/** Only a new or empty split gets a proposal (the stored one is never replaced) and only while the shares were not touched. */
export const canPropose = (saved: SavedExpenseView | undefined, split: SplitDraft): boolean => split.shares === null && (saved === undefined || saved.shares.length === 0);
/** One «resto» row per current member: a draft the person confirms; no payer is ever proposed. */
export const proposeShares = (memberIds: readonly string[]): ShareRow[] => memberIds.map((userId) => ({ key: newRowKey(), userId, unit: "remainder" as const, value: "" }));
/** An explicit inclusion: never duplicates a person and never touches the rows already there. */
export const includeMember = (rows: ShareRow[], userId: string, unit: ShareUnit = "remainder"): ShareRow[] =>
  rows.some((row) => row.userId === userId) ? rows : [...rows, { key: newRowKey(), userId, unit, value: "" }];
export const includeAll = (rows: ShareRow[], memberIds: readonly string[]): ShareRow[] => memberIds.reduce((current, userId) => includeMember(current, userId), rows);

/** Users of the rows that are not current members, numbered by order of appearance; empty until the member list is known. */
export const formerLabels = (people: PhotoPeople, payments: readonly PaymentRow[], shares: readonly ShareRow[]): Map<string, string> => {
  const labels = new Map<string, string>();
  if (!people.loaded) return labels;
  for (const { userId } of [...payments, ...shares]) {
    if (!people.names.has(userId) && !labels.has(userId)) labels.set(userId, `Ex integrante ${labels.size + 1}`);
  }
  return labels;
};

// ---- comparing and sending ----

const cents = (unit: string, text: string): string | undefined => {
  if (unit === "remainder" || unit === "excluded") return "";
  const parsed = parseAmount(text, { allowZero: true });
  return parsed.ok ? String(parsed.cents) : undefined;
};
const signature = (rows: readonly { userId: string; unit: string; value: string }[]): string | undefined => {
  const parts: string[] = [];
  for (const row of rows) {
    const value = cents(row.unit, row.value);
    if (value === undefined) return undefined;
    parts.push(`${row.userId}|${row.unit}|${value}`);
  }
  return parts.join(";");
};
const savedSignature = (rows: readonly { userId: string; unit: string; value: number | null }[]) =>
  signature(rows.map((row) => ({ userId: row.userId, unit: row.unit, value: valueText(row.unit, row.value) })));
const sameList = (a: readonly (PaymentRow | ShareRow)[] | null, b: readonly (PaymentRow | ShareRow)[] | null) =>
  a === null || b === null ? a === b : signature(a) !== undefined && signature(a) === signature(b);
export const sameSplit = (a: SplitDraft, b: SplitDraft): boolean => sameList(a.payments, b.payments) && sameList(a.shares, b.shares);

/** What the editor stores on Accept: a section equal to the stored one stays untouched (`null`), so a save without changes sends nothing. */
export const commitSplit = (working: WorkingSplit, saved: SavedExpenseView | undefined): SplitDraft => ({
  payments: sameList(working.payments, savedSplit(saved).payments) ? null : working.payments,
  shares: sameList(working.shares, savedSplit(saved).shares) ? null : working.shares });

const wire = (rows: readonly (PaymentRow | ShareRow)[]): { userId: string; unit: string; value: number | null }[] | undefined => {
  const out: { userId: string; unit: string; value: number | null }[] = [];
  for (const row of rows) {
    if (row.unit === "remainder" || row.unit === "excluded") { out.push({ userId: row.userId, unit: row.unit, value: null }); continue; }
    const value = parseRowValue(row.unit, row.value, isSaved(row.key));
    if (!value.ok) return undefined;
    out.push({ userId: row.userId, unit: row.unit, value: value.value });
  }
  return out;
};
const listInput = <T,>(rows: readonly (PaymentRow | ShareRow)[] | null, stored: readonly { userId: string; unit: string; value: number | null }[] | undefined): T[] | undefined => {
  if (rows === null) return undefined;
  const sent = wire(rows);
  if (sent === undefined) return undefined;
  if (stored === undefined) return sent.length === 0 ? undefined : sent as T[];
  if (sent.length === 0) return stored.length > 0 ? [] : undefined;
  return savedSignature(stored) === signature(rows) ? undefined : sent as T[];
};
/**
 * Merge-patch of the lists against the stored expense: a list travels only when it changed (person, unit or value in cents, in order);
 * `[]` only when the person emptied a list that had rows. A stored legacy payer read as 100 percent is not resent unless it changed.
 */
export const splitInput = (split: SplitDraft, saved: SavedExpenseView | undefined): { payments?: ExpensePaymentRow[]; shares?: ExpenseShareRow[] } => {
  const payments = listInput<ExpensePaymentRow>(split.payments, saved?.payments), shares = listInput<ExpenseShareRow>(split.shares, saved?.shares);
  return { ...(payments !== undefined ? { payments } : {}), ...(shares !== undefined ? { shares } : {}) };
};

/** Row keys by position of the lists as they were sent (a changed list travels whole, in the order of the draft). */
export const sentSplitKeys = (split: SplitDraft): { payments: string[]; shares: string[] } =>
  ({ payments: (split.payments ?? []).map((row) => row.key), shares: (split.shares ?? []).map((row) => row.key) });

const serverRowMessages: Record<string, string> = { duplicate_user: duplicateMessage, not_member: "Esta persona ya no integra el viaje: no se puede agregar.",
  exceeds_max: valueMessages.exceeds_max, invalid_user: "Esta persona no es válida.", invalid_unit: "Elegí una opción válida.", invalid_value: "Revisá el valor.", unexpected_value: "Esta opción no lleva valor." };
const excessListMessage = "Los valores exceden el total. Ajustalos.";
/** Maps the 422 fields about payments and shares to rows (through the keys sent) and lists; `handled` is false when none of them could be placed. */
export const mapSplitFieldErrors = (fields: readonly { field: string; code?: string; message?: string }[], keys: { payments: readonly string[]; shares: readonly string[] }):
  { rowErrors: RowErrors; listErrors: ListErrors; handled: boolean } => {
  const rowErrors: RowErrors = {}, listErrors: ListErrors = {};
  let handled = false;
  for (const { field, code } of fields) {
    const row = /^expense\.(payments|shares)\[(\d+)\]\.(userId|unit|value)$/.exec(field);
    if (row) {
      const key = keys[row[1] as "payments" | "shares"][Number(row[2])];
      if (key === undefined) continue;
      rowErrors[key] ??= serverRowMessages[code ?? ""] ?? "Revisá esta fila.";
      handled = true;
      continue;
    }
    const list = /^expense\.(payments|shares)$/.exec(field);
    if (list) { listErrors[list[1] as "payments" | "shares"] ??= excessListMessage; handled = true; }
  }
  return { rowErrors, listErrors, handled };
};
