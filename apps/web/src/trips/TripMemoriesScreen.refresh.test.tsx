// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoriesLayout, TripMemoriesScreen } from "./TripMemoriesScreen.js";
import { itineraryId } from "./itinerary-test-fixture.js";
import { TripRefreshProvider, useRefreshNow } from "./trip-refresh.js";
import type { PostResponse } from "./trip-post-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const tripId = itineraryId(1);
const post = (n: number, createdAt: string, description: string | null = `Recuerdo ${n}`): PostResponse => ({ id: itineraryId(n), tripId, authorId: itineraryId(20),
  description, mapsUrl: null, activityId: null, parentPostId: null, transportId: null, createdAt });
type Result = { ok: true; value: PostResponse[] } | { ok: false; error: { kind: string } };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

let where = "";
function Spy() { where = useLocation().pathname; return null; }
function RefreshButton() { const refresh = useRefreshNow(); return <button type="button" data-refresh onClick={() => void refresh()}>Refrescar ahora</button>; }
async function mount(results: (() => Result | Promise<Result>)[], state?: unknown) {
  const list = vi.fn().mockImplementation(async () => results[Math.min(list.mock.calls.length - 1, results.length - 1)]!());
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[{ pathname: `/trips/${tripId}/memories`, state }]}><Spy /><Routes>
    <Route path="/trips" element={<p data-gone>MIS VIAJES</p>} />
    <Route path="/trips/:tripId/memories" element={<TripRefreshProvider tripId={tripId}><RefreshButton /><MemoriesLayout /></TripRefreshProvider>}>
      <Route index element={<TripMemoriesScreen posts={{ list }} timeZone="UTC" />} />
    </Route>
  </Routes></MemoryRouter>));
  return { container, list };
}
const refresh = () => act(async () => { document.querySelector<HTMLElement>("[data-refresh]")!.click(); });
const items = () => Array.from(document.querySelectorAll("[data-memory]")).map((item) => item.querySelector("p")?.textContent);
const first = { ok: true as const, value: [post(11, "2026-01-01T10:00:00.000Z")] };

describe("memories: silent refresh", () => {
  it("brings the new memory without «Actualizando…» and without a banner", async () => {
    const gate = deferred<Result>();
    await mount([() => first, () => gate.promise]);
    await refresh();
    expect(document.body.textContent).not.toContain("Actualizando recuerdos");
    await act(async () => gate.resolve({ ok: true, value: [post(11, "2026-01-01T10:00:00.000Z"), post(12, "2026-01-02T10:00:00.000Z")] }));
    expect(items()).toEqual(["Recuerdo 12", "Recuerdo 11"]);
  });

  it("an identical answer keeps the rendered nodes", async () => {
    await mount([() => first, () => ({ ok: true, value: [post(11, "2026-01-01T10:00:00.000Z")] })]);
    const node = document.querySelector("[data-memory]");
    await refresh();
    expect(document.querySelector("[data-memory]")).toBe(node);
  });

  it("a network failure with data is silent: no banner, no loading, the list stays", async () => {
    await mount([() => first, () => ({ ok: false, error: { kind: "network" } })]);
    await refresh();
    expect(document.body.textContent).not.toContain("No pudimos actualizar los recuerdos");
    expect(document.body.textContent).not.toContain("Actualizando recuerdos");
    expect(items()).toEqual(["Recuerdo 11"]);
  });

  it("a memory saved locally and still missing from the answer is kept", async () => {
    const saved = post(30, "2026-01-05T10:00:00.000Z", "Recién publicado");
    await mount([() => first], { post: saved, notice: "created" });
    await refresh();
    expect(items()).toEqual(["Recién publicado", "Recuerdo 11"]);
  });

  it.each(["forbidden", "not-found"])("%s leads to Mis viajes with no memories on screen", async (kind) => {
    await mount([() => first, () => ({ ok: false, error: { kind } })]);
    await refresh();
    expect(document.querySelector("[data-gone]")).not.toBeNull();
    expect(where).toBe("/trips");
    expect(document.body.textContent).not.toContain("Recuerdo 11");
  });

  it("a session failure neither navigates nor wipes the list", async () => {
    await mount([() => first, () => ({ ok: false, error: { kind: "unauthorized" } })]);
    await refresh();
    expect(document.querySelector("[data-gone]")).toBeNull();
    expect(items()).toEqual(["Recuerdo 11"]);
  });

  it("does not repeat a request that is in flight", async () => {
    const gate = deferred<Result>();
    const { list } = await mount([() => first, () => gate.promise]);
    await refresh(); await refresh();
    expect(list).toHaveBeenCalledTimes(2);
    await act(async () => gate.resolve(first));
  });
});
