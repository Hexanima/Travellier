// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { TransportCostSummary } from "./TransportCostSummary.js";
import type { CostTransport } from "./transport-cost-summary.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });

type Props = Parameters<typeof TransportCostSummary>[0];
const destinations = [{ id: "d1", name: "Córdoba" }];
const transport = (id: string, costPerPerson: number | null, costCurrency: CostTransport["costCurrency"], direction = "outbound"): CostTransport =>
  ({ id, destinationId: "d1", direction, departurePlace: "Buenos Aires", arrivalPlace: "Córdoba", costPerPerson, costCurrency });
const none = { byCurrency: [], withoutCurrency: { transportCount: 0 } };

async function render(props: Partial<Props> & { totals: Props["totals"] }) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<TransportCostSummary transports={[]} destinations={destinations} {...props} />));
  return container;
}

describe("TransportCostSummary", () => {
  it("renders nothing without data", async () => {
    expect((await render({ totals: none })).textContent).toBe("");
    expect((await render({ totals: none, transports: [transport("t1", null, null)] })).textContent).toBe("");
  });

  it("shows one row per currency as the server totalled it, without mixing or converting, and the note", async () => {
    const container = await render({ totals: { byCurrency: [
      { currency: "ARS", totalCents: 123456, transportCount: 2 }, { currency: "USD", totalCents: 5000, transportCount: 1 }],
    withoutCurrency: { transportCount: 0 } }, transports: [transport("t1", 1234.56, "ARS")] });
    expect(container.textContent).toContain("Total del viaje");
    expect(container.querySelector('[data-transport-currency="ARS"]')?.textContent).toBe("ARS 1.234,56 · 2 transportes");
    expect(container.querySelector('[data-transport-currency="USD"]')?.textContent).toBe("USD 50,00 · 1 transporte");
    expect(container.querySelector('[data-transport-currency="EUR"]')).toBeNull();
    expect(container.textContent).not.toContain("Moneda sin indicar");
    expect(container.textContent).toContain("No es un gasto ni entra en el balance. No se convierten monedas.");
  });

  it("lists a cost without currency apart, with its plain amount and no total", async () => {
    const container = await render({ totals: { byCurrency: [{ currency: "EUR", totalCents: 1000, transportCount: 1 }], withoutCurrency: { transportCount: 1 } },
      transports: [transport("t1", 10, "EUR"), transport("t2", 80.5, null, "return")] });
    const block = container.querySelector("[data-transport-cost-unindicated]")!;
    expect(block.textContent).toContain("Moneda sin indicar");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(block.querySelector('[role="status"]')?.textContent).toContain("Moneda sin indicar");
    expect(block.querySelector('[data-transport-cost-line="t2"]')?.textContent).toBe("Córdoba · Buenos Aires → Córdoba: 80,50");
    expect(block.querySelector('[data-transport-cost-line="t1"]')).toBeNull();
    expect(container.querySelector('[data-transport-currency="EUR"]')?.textContent).toContain("EUR 10,00");
  });

  it("shows only the unindicated block when no currency has a total", async () => {
    const container = await render({ totals: { byCurrency: [], withoutCurrency: { transportCount: 1 } }, transports: [transport("t2", 80, null)] });
    expect(container.querySelector("[data-transport-currency]")).toBeNull();
    expect(container.textContent).toContain("Moneda sin indicar");
  });

  it("shows the number as is when it has no cents representation", async () => {
    const container = await render({ totals: { byCurrency: [], withoutCurrency: { transportCount: 1 } }, transports: [transport("t2", 1e20, null)] });
    expect(container.querySelector('[data-transport-cost-line="t2"]')?.textContent).toContain(": 100000000000000000000");
  });
});
