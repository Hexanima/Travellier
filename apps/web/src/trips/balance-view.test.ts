import { describe, expect, it } from "vitest";
import { balanceReasons, type TripBalance } from "./trip-balance-api.js";
import { balanceLabels, excludedActions, excludedAmount, formerText, memberStatus, reasonText, settlementText } from "./balance-view.js";
import { itineraryId } from "./itinerary-test-fixture.js";
import type { PhotoPeople } from "./photo-people.js";

const me = itineraryId(20), beto = itineraryId(21), gone1 = itineraryId(22), gone2 = itineraryId(23), back = itineraryId(24);
const entry = (userId: string, net: number, formerMember = false) => ({ userId, paidCents: Math.max(net, 0), shareCents: Math.max(-net, 0), netCents: net, formerMember });
const excluded = (formerMemberIds: string[]) => ({ expenseId: itineraryId(40), postId: itineraryId(41), currency: "ARS" as const, totalCents: 100, reasons: ["missing_shares" as const], formerMemberIds });
const balance = (over: Partial<TripBalance> = {}): TripBalance => ({ tripId: itineraryId(1), expenseMode: "balance", includedExpenseCount: 2, excludedExpenses: [],
  currencies: [
    { currency: "ARS", expenseCount: 1, balances: [entry(me, 500), entry(gone1, -500, true)], settlements: [{ fromUserId: gone1, toUserId: me, cents: 500 }] },
    { currency: "USD", expenseCount: 1, balances: [entry(beto, 300), entry(gone2, -300, true), entry(gone1, 0, true)], settlements: [{ fromUserId: gone2, toUserId: beto, cents: 300 }] }],
  ...over });
const people = (names: [string, string][], loaded = true): PhotoPeople => ({ loaded, currentUserId: me, names: new Map(names) });
const loaded = people([[me, "Ana"], [beto, "Beto"]]);

describe("balance labels", () => {
  it("names the viewer, the members and numbers former members by first appearance, the same in every section", () => {
    const label = balanceLabels(balance(), loaded);
    expect([label(me), label(beto), label(gone1), label(gone2)]).toEqual(["Vos", "Beto", "Ex integrante 1", "Ex integrante 2"]);
  });
  it("numbers the former members of pending expenses after those of the balances", () => {
    const label = balanceLabels(balance({ excludedExpenses: [excluded([back, gone1])] }), loaded);
    expect(label(back)).toBe("Ex integrante 3");
    expect(label(gone1)).toBe("Ex integrante 1");
  });
  it("lets the server mark win over the inference: someone absent from the members who is not former is not renamed", () => {
    const label = balanceLabels(balance({ currencies: [{ currency: "ARS", expenseCount: 1, balances: [entry(me, 100), entry(back, -100, false)], settlements: [] }] }), loaded);
    expect(label(back)).toBe("Integrante");
  });
  it("lets the server mark win over a current name", () => {
    const label = balanceLabels(balance(), people([[me, "Ana"], [beto, "Beto"], [gone1, "Gabi"]]));
    expect(label(gone1)).toBe("Ex integrante 1");
  });
  it("uses a generic label when the members did not load, but still marks former members", () => {
    const label = balanceLabels(balance(), people([], false));
    expect([label(me), label(beto), label(gone1)]).toEqual(["Integrante", "Integrante", "Ex integrante 1"]);
  });
  it("uses the generic label for a current member without a name", () => {
    expect(balanceLabels(balance(), people([[me, "Ana"], [beto, ""]]))(beto)).toBe("Integrante");
  });
});

describe("balance texts", () => {
  it("says who is owed and who owes, and never invents a balance of zero", () => {
    expect(memberStatus(500, "ARS")).toBe("Tiene a favor ARS 5,00");
    expect(memberStatus(-123456, "USD")).toBe("Debe USD 1.234,56");
    expect(memberStatus(0, "EUR")).toBe("Sin saldo pendiente");
  });
  it("writes suggestions, not facts", () => {
    expect(settlementText("Ana", "Beto", 1000, "ARS")).toBe("Ana le debe ARS 10,00 a Beto");
    expect(settlementText("Vos", "Beto", 1000, "ARS")).toBe("Vos le debés ARS 10,00 a Beto");
    expect(settlementText("Ana", "Vos", 1000, "ARS")).toBe("Ana te debe ARS 10,00");
  });
  it("has a readable text for each of the seven reasons", () => {
    expect(Object.keys(reasonText).sort()).toEqual([...balanceReasons].sort());
    expect(reasonText.missing_currency).toBe("Falta indicar la moneda");
    expect(reasonText.invalid_rules).toMatch(/revisalos en el recuerdo/);
    for (const reason of balanceReasons) expect(reasonText[reason].length).toBeGreaterThan(5);
  });
  it("formats the amount of a pending expense without assuming a currency", () => {
    expect(excludedAmount({ currency: "EUR", totalCents: 1050 })).toBe("EUR 10,50");
    expect(excludedAmount({ currency: null, totalCents: 3000 })).toBe("30,00 (moneda sin indicar)");
    expect(excludedAmount({ currency: "ARS", totalCents: null })).toBe("Importe no disponible");
    expect(excludedAmount({ currency: null, totalCents: null })).toBe("Importe no disponible");
  });
  it("lists the former members of a pending expense", () => {
    const label = balanceLabels(balance({ excludedExpenses: [excluded([gone2, back])] }), loaded);
    expect(formerText([gone2, back], label)).toBe("Incluye a ex integrantes: Ex integrante 2, Ex integrante 3");
  });
  it("offers the split editor, the currency selector or both depending on the reasons", () => {
    expect(excludedActions(["missing_payments"])).toEqual(["split"]);
    expect(excludedActions(["invalid_rules"])).toEqual(["split"]);
    expect(excludedActions(["missing_currency"])).toEqual(["expense"]);
    expect(excludedActions(["missing_currency", "shares_not_covering_total"])).toEqual(["split", "expense"]);
  });
  it("never says a debt was paid, collected or settled", () => {
    const texts = [memberStatus(1, "ARS"), memberStatus(-1, "ARS"), memberStatus(0, "ARS"), settlementText("Ana", "Beto", 1, "ARS"), ...Object.values(reasonText), excludedAmount({ currency: null, totalCents: 1 })];
    for (const text of texts) expect(text).not.toMatch(/pagad|cobrad|liquidad|saldad/i);
  });
});
