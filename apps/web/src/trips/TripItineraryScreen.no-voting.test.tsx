// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { itineraryFixture, itineraryId } from "./itinerary-test-fixture.js";
import type { TripItineraryResponse } from "./trip-itinerary-api.js";
import { TripItineraryScreen } from "./TripItineraryScreen.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const approvalLabels = ["Propuesta", "En votación", "Confirmada"];
// Legacy payload: cached/old responses may still carry the retired voting fields; the client must ignore them.
const legacyFixture = () => {
  const value = itineraryFixture() as TripItineraryResponse & { votingEnabled?: boolean };
  value.votingEnabled = true;
  value.activities.forEach((activity, index) => { (activity as { status?: string }).status = index % 2 === 0 ? "proposed" : "voting"; });
  return value;
};
async function render() {
  const value = legacyFixture();
  const voteRequest = vi.fn();
  const getActivity = vi.fn(async (_tripId: string, id: string) => ({ ok: true as const, value: value.activities.find((a) => a.id === id)! }));
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[`/trips/${value.tripId}/itinerary`]}>
    <Routes><Route path="/trips/:tripId/itinerary" element={<TripItineraryScreen itinerary={{ get: async () => ({ ok: true, value }) }}
      activities={{ get: getActivity, create: async () => ({ ok: false, error: { kind: "server" } }), update: async () => ({ ok: false, error: { kind: "server" } }) }}
      participations={{ get: async () => ({ ok: true, value: null }), set: async () => ({ ok: false, error: { kind: "server" } }) }}
      {...({ votes: { get: voteRequest, set: voteRequest } } as object)}
      timeZone="UTC" />} /></Routes>
  </MemoryRouter>));
  return { container, voteRequest, value };
}
const card = (container: HTMLElement, id = itineraryId(8)) => container.querySelector<HTMLElement>(`[data-itinerary-item="${id}"]`)!;
const noVoting = (scope: HTMLElement) => {
  for (const label of approvalLabels) expect(scope.textContent).not.toContain(label);
  expect(scope.querySelector('.activity-vote, [class*="activity-vote"], fieldset[aria-label^="Tu voto"]')).toBeNull();
  expect(Array.from(scope.querySelectorAll("button")).map((b) => b.textContent)).not.toEqual(expect.arrayContaining(["A favor"]));
  expect(Array.from(scope.querySelectorAll("button")).map((b) => b.textContent)).not.toEqual(expect.arrayContaining(["En contra"]));
};

describe("itinerary without voting", () => {
  it("ignores legacy voting fields in agenda and keeps participation controls", async () => {
    const { container, voteRequest } = await render();
    expect(card(container).textContent).toContain("Paseo por el centro");
    noVoting(container);
    const participation = card(container).querySelector('fieldset[aria-label^="Tu participación"]');
    expect(participation).not.toBeNull();
    expect(participation?.textContent).toContain("Voy");
    expect(participation?.textContent).toContain("No voy");
    expect(participation?.textContent).toContain("Sin responder");
    expect(Array.from(participation!.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Voy", "No voy"]);
    expect(voteRequest).not.toHaveBeenCalled();
  });
  it("keeps an activity without participants visible", async () => {
    const { container } = await render();
    expect(card(container)).not.toBeNull();
    expect(card(container).querySelector('fieldset[aria-label^="Tu participación"] [aria-pressed="true"]')).toBeNull();
    expect(card(container).querySelector(".activity-participation-status")?.textContent).toBe("Sin responder");
  });
  it("shows no approval labels or vote controls in the detail and keeps participation", async () => {
    const { container, voteRequest } = await render();
    await act(async () => card(container).querySelector<HTMLButtonElement>(".activity-title")!.click());
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Paseo por el centro");
    noVoting(dialog);
    expect(dialog.querySelector('fieldset[aria-label^="Tu participación"]')).not.toBeNull();
    expect(voteRequest).not.toHaveBeenCalled();
  });
});
