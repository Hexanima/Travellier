// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TripMembersScreen } from "./TripMembersScreen.js";
import { TripRefreshProvider, useRefreshNow } from "./trip-refresh.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tripId = "507f191e810c19729de860ea", adminId = "507f1f77bcf86cd799439011", participantId = "507f1f77bcf86cd799439012", newId = "507f1f77bcf86cd799439015";
const trip = { kind: "member", id: tripId, name: "Patagonia", description: null, primaryDestination: { name: "Bariloche" }, visibility: "private", inviteCode: "VIAJE-X7K2", expenseMode: "register" };
const member = (id: string, userId: string, name: string, role: string) => ({ id, userId, name, role, isOwner: userId === adminId, joinedAt: "2026-09-24T12:00:00.000Z" });
const admin = member("507f1f77bcf86cd799439013", adminId, "Nico", "admin");
const participant = member("507f1f77bcf86cd799439014", participantId, "Ana", "participant");
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); vi.useRealTimers(); });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

let where = "";
function Spy() { where = useLocation().pathname; return null; }
function RefreshButton() { const refresh = useRefreshNow(); return <button type="button" data-refresh onClick={() => void refresh()}>Refrescar ahora</button>; }
const listing = (members: unknown[], currentUserId = adminId, ownerId: string | null = adminId) => ({ ok: true, value: { members, currentUserId, ownerId } });
async function mount(options: { get?: ReturnType<typeof vi.fn>; list?: ReturnType<typeof vi.fn> } = {}) {
  const get = options.get ?? vi.fn().mockResolvedValue({ ok: true, value: trip });
  const list = options.list ?? vi.fn().mockResolvedValue(listing([admin, participant]));
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[`/trips/${tripId}/members`]}><Spy /><Routes>
    <Route path="/trips" element={<h1 data-gone>Mis viajes</h1>} />
    <Route path="/trips/:tripId/members" element={<TripRefreshProvider tripId={tripId}><RefreshButton />
      <TripMembersScreen trips={{ get, deleteTrip: vi.fn() } as never} members={{ list, expel: vi.fn(), setRole: vi.fn(), transferOwnership: vi.fn(), leave: vi.fn() }} apiBaseUrl="https://api.example.test" /></TripRefreshProvider>} />
  </Routes></MemoryRouter>));
  return { container, get, list };
}
const refresh = () => act(async () => { document.querySelector<HTMLElement>("[data-refresh]")!.click(); });
const names = () => Array.from(document.querySelectorAll(".trip-member-item")).map((item) => item.firstElementChild?.textContent);
const button = (label: string) => Array.from(document.querySelectorAll("button")).find((item) => item.textContent === label);

describe("members: silent refresh", () => {
  it("keeps the list and the Trip on screen while it asks and then shows the new member", async () => {
    const gate = deferred<unknown>();
    const { list } = await mount();
    list.mockReturnValueOnce(gate.promise);
    await refresh();
    expect(document.body.textContent).not.toContain("Cargando miembros");
    expect(names()).toEqual(["Nico (vos)", "Ana"]);
    expect(document.body.textContent).toContain("Patagonia");
    await act(async () => gate.resolve(listing([admin, participant, member("507f1f77bcf86cd799439016", newId, "Luz", "participant")])));
    expect(names()).toEqual(["Nico (vos)", "Ana", "Luz"]);
  });

  it("a network failure is silent and keeps the list", async () => {
    const { list } = await mount();
    list.mockResolvedValueOnce({ ok: false, error: { kind: "network" } });
    await refresh();
    expect(names()).toEqual(["Nico (vos)", "Ana"]);
    expect(document.body.textContent).not.toContain("No pudimos cargar los miembros");
  });

  it("an identical answer keeps the rendered rows", async () => {
    await mount();
    const row = document.querySelector(".trip-member-item");
    await refresh();
    expect(document.querySelector(".trip-member-item")).toBe(row);
  });

  it("if the person is no longer listed (expelled) it goes to Mis viajes without Trip data", async () => {
    const { list } = await mount();
    list.mockResolvedValueOnce(listing([participant], adminId));
    await refresh();
    expect(document.querySelector("[data-gone]")).not.toBeNull();
    expect(where).toBe("/trips");
    expect(document.body.textContent).not.toContain("Patagonia");
  });

  it.each(["not-found", "forbidden"])("%s on the Trip or on the list goes to Mis viajes", async (kind) => {
    for (const target of ["get", "list"] as const) {
      const { get, list } = await mount();
      (target === "get" ? get : list).mockResolvedValueOnce({ ok: false, error: { kind } });
      await refresh();
      expect(where).toBe("/trips");
      await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren();
    }
  });

  it("a session failure neither navigates nor wipes the list", async () => {
    const { list } = await mount();
    list.mockResolvedValueOnce({ ok: false, error: { kind: "unauthorized" } });
    await refresh();
    expect(document.querySelector("[data-gone]")).toBeNull();
    expect(names()).toEqual(["Nico (vos)", "Ana"]);
  });

  it("waits while the expulsion dialog is open and catches up once when it closes", async () => {
    vi.useFakeTimers();
    const { list } = await mount();
    await act(async () => button("Gestionar")!.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    const asked = list.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(list.mock.calls.length).toBe(asked);
    await act(async () => button("Cancelar")!.click());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(list.mock.calls.length).toBe(asked + 1);
  });

  it("an actor demoted by the refresh loses the management controls and deletion", async () => {
    const { list } = await mount();
    expect(button("Eliminar viaje")).toBeDefined();
    list.mockResolvedValueOnce(listing([{ ...admin, role: "participant", isOwner: false }, participant], adminId, null));
    await refresh();
    expect(document.querySelector("[data-member-action=manage]")).toBeNull();
    expect(button("Eliminar viaje")).toBeUndefined();
    expect(button("Salir del viaje")).toBeDefined();
  });

  it("when the owner stops being the owner, deletion goes away and leaving becomes direct", async () => {
    const { list } = await mount();
    list.mockResolvedValueOnce(listing([admin, { ...participant, role: "admin", isOwner: true }], adminId, participantId));
    await refresh();
    expect(button("Eliminar viaje")).toBeUndefined();
    expect(document.querySelector("[data-member-action=manage]")).toBeNull();
    await act(async () => button("Salir del viaje")!.click());
    expect(button("Confirmar salida")).toBeDefined();
  });

  it("closes the manage dialog opened during an in-flight refresh when the target no longer admits the action", async () => {
    const gate = deferred<unknown>();
    const { list } = await mount();
    list.mockReturnValueOnce(gate.promise);
    await refresh();
    await act(async () => button("Gestionar")!.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => gate.resolve(listing([admin, participant].map((item) => item.userId === participantId ? { ...item, role: "admin" } : item), adminId, adminId)));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    const gate2 = deferred<unknown>();
    await act(async () => button("Cancelar")!.click());
    list.mockReturnValueOnce(gate2.promise);
    await refresh();
    await act(async () => button("Gestionar")!.click());
    await act(async () => gate2.resolve(listing([admin], adminId, adminId)));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).toContain("Tu permiso cambió");
  });
});
