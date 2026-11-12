import { describe, expect, it } from "vitest";

import type { Currency } from "../value-objects/money.js";
import { transportCostTotals } from "./transport-cost-projection.js";

const t = (costPerPerson: number | null, costCurrency: Currency | null) => ({ costPerPerson, costCurrency });

describe("transportCostTotals", () => {
  it("is empty without transports", () => {
    expect(transportCostTotals([])).toEqual({ byCurrency: [], withoutCurrency: { transportCount: 0 } });
  });

  it("totals per currency across destinations in fixed order ARS, EUR, USD", () => {
    const totals = transportCostTotals([t(100, "USD"), t(50.5, "ARS"), t(20, "EUR"), t(30, "USD"), t(10, "ARS")]);
    expect(totals).toEqual({
      byCurrency: [
        { currency: "ARS", totalCents: 6050, transportCount: 2 },
        { currency: "EUR", totalCents: 2000, transportCount: 1 },
        { currency: "USD", totalCents: 13000, transportCount: 2 },
      ],
      withoutCurrency: { transportCount: 0 },
    });
  });

  it("lists only currencies with costs and never mixes them", () => {
    expect(transportCostTotals([t(10, "EUR"), t(10, "USD")]).byCurrency.map((total) => total.currency)).toEqual(["EUR", "USD"]);
  });

  it("sums exact decimals in cents", () => {
    expect(transportCostTotals([t(0.1, "ARS"), t(0.2, "ARS")]).byCurrency).toEqual([{ currency: "ARS", totalCents: 30, transportCount: 2 }]);
  });

  it("ignores transports without cost", () => {
    expect(transportCostTotals([t(null, null), t(5, "ARS")])).toEqual({
      byCurrency: [{ currency: "ARS", totalCents: 500, transportCount: 1 }],
      withoutCurrency: { transportCount: 0 },
    });
  });

  it("counts a cost without currency apart and does not add it", () => {
    expect(transportCostTotals([t(100, null), t(5, "ARS")])).toEqual({
      byCurrency: [{ currency: "ARS", totalCents: 500, transportCount: 1 }],
      withoutCurrency: { transportCount: 1 },
    });
  });

  it.each([-5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER * 10])("sends an invalid amount %s to withoutCurrency", (amount) => {
    expect(transportCostTotals([t(amount, "USD")])).toEqual({ byCurrency: [], withoutCurrency: { transportCount: 1 } });
  });
});

describe("transportCostTotals limits (T133)", () => {
  it("counts apart a cost whose sum would exceed the safe integer range", () => {
    const totals = transportCostTotals([t(90071992547409.9, "ARS"), t(90071992547409.9, "ARS"), t(1, "EUR")]);
    expect(totals.byCurrency).toEqual([
      { currency: "ARS", totalCents: 9007199254740990, transportCount: 1 },
      { currency: "EUR", totalCents: 100, transportCount: 1 },
    ]);
    expect(totals.withoutCurrency).toEqual({ transportCount: 1 });
  });
  it("counts apart stored negative or over-precise costs without throwing", () => {
    expect(transportCostTotals([t(-5, "ARS"), t(Number.NaN, "ARS"), t(2, "ARS")])).toEqual({
      byCurrency: [{ currency: "ARS", totalCents: 200, transportCount: 1 }],
      withoutCurrency: { transportCount: 2 },
    });
  });
});
