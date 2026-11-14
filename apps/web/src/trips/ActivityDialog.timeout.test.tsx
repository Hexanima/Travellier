// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityDialog } from "./ActivityDialog.js";
import { itineraryFixture } from "./itinerary-test-fixture.js";
import type { TripItineraryResponse } from "./trip-itinerary-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });

const render = async (get: ReturnType<typeof vi.fn>) => {
  const value = itineraryFixture() as TripItineraryResponse;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<ActivityDialog request={{ kind: "detail", activityId: value.activities[0]!.id }} itinerary={value}
    timeZone="America/Argentina/Buenos_Aires" activities={{ create: vi.fn(), get, update: vi.fn(), remove: vi.fn() }}
    onClose={vi.fn()} onSaved={vi.fn()} onRemoved={vi.fn()} />));
  return container;
};
const retry = (container: HTMLElement) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Reintentar");

describe("ActivityDialog ante un fallo de red (T150)", () => {
  it("un timeout tiene su propio texto y conserva el reintento", async () => {
    const container = await render(vi.fn().mockResolvedValue({ ok: false, error: { kind: "network", code: "TimeoutError" } }));
    expect(container.textContent).toContain("La conexión tardó demasiado. Intentá nuevamente.");
    expect(container.textContent).not.toContain("No pudimos cargar la actividad");
    expect(retry(container)).toBeDefined();
  });

  it("una conexión caída conserva el texto de siempre", async () => {
    const container = await render(vi.fn().mockResolvedValue({ ok: false, error: { kind: "network", code: "NetworkError" } }));
    expect(container.textContent).toContain("No pudimos cargar la actividad. Revisá tu conexión e intentá nuevamente.");
    expect(container.textContent).not.toContain("tardó demasiado");
  });
});
