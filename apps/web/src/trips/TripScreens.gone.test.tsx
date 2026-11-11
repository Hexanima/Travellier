// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TripsListScreen } from "./TripScreens.js";
import { resetRememberedFilter } from "./trips-filter-memory.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { resetRememberedFilter(); await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });

let state: unknown;
function Spy() { state = useLocation().state; return null; }
async function render(entryState?: unknown) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const list = vi.fn().mockResolvedValue({ ok: true, value: [] });
  await act(async () => root.render(<MemoryRouter initialEntries={[{ pathname: "/trips", state: entryState }]}><Spy />
    <Routes><Route path="/trips" element={<TripsListScreen trips={{ list }} onLocalLogout={async () => undefined} />} /></Routes></MemoryRouter>));
  return container;
}

describe("Mis viajes: Trip lost", () => {
  it("shows a brief generic notice when the person comes from a Trip they lost, and clears the mark", async () => {
    const container = await render({ tripGone: true });
    const notice = container.querySelector('[role="status"], [role="alert"]');
    expect(container.textContent).toContain("Ya no tenés acceso a ese viaje.");
    expect(notice).not.toBeNull();
    expect(state).toBeNull();
  });
  it("shows nothing special without the mark or with a different one", async () => {
    expect((await render()).textContent).not.toContain("Ya no tenés acceso");
    await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren();
    expect((await render({ tripGone: "yes" })).textContent).not.toContain("Ya no tenés acceso");
  });
});
