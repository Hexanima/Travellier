// @vitest-environment jsdom
// T121: refresh of the Trip with the real App, simulated lifecycle and the router history.
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.js";
import type { AppLifecycle } from "./native/app-lifecycle.js";
import { itineraryFixture, itineraryId } from "./trips/itinerary-test-fixture.js";
import type { TripItineraryResponse } from "./trips/trip-itinerary-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); window.scrollTo = vi.fn() as never; });
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });

const A = itineraryId(1), me = itineraryId(20);
const storage = () => ({ read: vi.fn().mockResolvedValue({ accessToken: "old", refreshToken: "refresh" }), save: vi.fn().mockResolvedValue(undefined), clear: vi.fn().mockResolvedValue(undefined) });
const auth = { refresh: vi.fn().mockResolvedValue({ ok: true, value: { accessToken: "access", refreshToken: "refresh" } }) };
const detail = (id: string) => ({ ok: true as const, value: { id, kind: "member" as const, name: "Patagonia", description: null, primaryDestination: { name: "Córdoba" }, visibility: "private", inviteCode: "ABC123", expenseMode: "register" } });
const memberList = (ids: string[]) => ({ ok: true, value: { currentUserId: me, members: ids.map((userId, index) => ({ id: itineraryId(60 + index), userId, name: userId === me ? "Yo" : "Ana", role: "admin", joinedAt: "2026-09-20T10:00:00.000Z" })) } });

function fakeLifecycle() {
  let resume: (() => void) | undefined;
  const stop = vi.fn();
  const lifecycle: AppLifecycle = { onResume: (listener) => { resume = listener; return stop; } };
  return { lifecycle, stop, resume: () => act(async () => { resume?.(); await Promise.resolve(); }) };
}
let here = { path: "", state: null as unknown };
let go: NavigateFunction = () => undefined;
function Spy() { go = useNavigate(); const l = useLocation(); here = { path: l.pathname, state: l.state }; return null; }
const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); }); };
async function render(entry: string, app: Partial<ComponentProps<typeof App>>) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={["/trips", entry]} initialIndex={1}><Spy /><App auth={auth} sessionStorage={storage()} {...app as object} /></MemoryRouter>));
  await settle();
  return container;
}
const fixtureFor = (id: string) => { const value = structuredClone(itineraryFixture()) as TripItineraryResponse; value.tripId = id; return value; };
const text = () => document.body.textContent ?? "";

describe("T121: access lost, with the app lifecycle simulated", () => {
  it("on resume with the access revoked the person ends in Mis viajes with the generic notice and no Trip data", async () => {
    const { lifecycle, resume } = fakeLifecycle();
    const get = vi.fn().mockResolvedValueOnce({ ok: true, value: fixtureFor(A) }).mockResolvedValue({ ok: false, error: { kind: "forbidden" } });
    await render(`/trips/${A}/itinerary`, { lifecycle, trips: { list: vi.fn().mockResolvedValue({ ok: true, value: [] }), get: vi.fn(async (id: string) => detail(id)) } as never,
      itinerary: { get } as never, members: { list: vi.fn().mockResolvedValue(memberList([me])) } as never });
    expect(text()).toContain("Paseo por el centro");
    await resume(); await settle();
    expect(here.path).toBe("/trips");
    expect(text()).toContain("Ya no tenés acceso a ese viaje.");
    expect(text()).not.toContain("Paseo por el centro");
    expect(text()).not.toContain("Patagonia");
    expect(here.state).toBeNull();
  });

  it("the Trip deleted while the group tab is open also leads to Mis viajes", async () => {
    const { lifecycle, resume } = fakeLifecycle();
    const get = vi.fn().mockResolvedValueOnce(detail(A)).mockResolvedValue({ ok: false, error: { kind: "not-found" } });
    await render(`/trips/${A}/members`, { lifecycle, trips: { list: vi.fn().mockResolvedValue({ ok: true, value: [] }), get, deleteTrip: vi.fn() } as never,
      members: { list: vi.fn().mockResolvedValue(memberList([me])), expel: vi.fn() } as never });
    expect(text()).toContain("Integrantes");
    await resume(); await settle();
    expect(here.path).toBe("/trips");
    expect(text()).toContain("Ya no tenés acceso a ese viaje.");
  });

  it("on resume a change on the server shows up and the screen stays where it was", async () => {
    const { lifecycle, resume } = fakeLifecycle();
    const changed = fixtureFor(A);
    changed.activities[0]!.title = "Paseo renombrado";
    const get = vi.fn().mockResolvedValueOnce({ ok: true, value: fixtureFor(A) }).mockResolvedValue({ ok: true, value: changed });
    await render(`/trips/${A}/itinerary`, { lifecycle, trips: { list: vi.fn().mockResolvedValue({ ok: true, value: [] }), get: vi.fn(async (id: string) => detail(id)) } as never, itinerary: { get } as never });
    await resume(); await settle();
    expect(text()).toContain("Paseo renombrado");
    expect(here.path).toBe(`/trips/${A}/itinerary`);
  });

  it("leaving the Trip stops listening to the lifecycle", async () => {
    const { lifecycle, stop } = fakeLifecycle();
    await render(`/trips/${A}/itinerary`, { lifecycle, trips: { list: vi.fn().mockResolvedValue({ ok: true, value: [] }), get: vi.fn(async (id: string) => detail(id)) } as never,
      itinerary: { get: vi.fn().mockResolvedValue({ ok: true, value: fixtureFor(A) }) } as never });
    expect(stop).not.toHaveBeenCalled();
    await act(async () => go("/trips")); await settle();
    expect(stop).toHaveBeenCalled();
  });

  it("a session failure on resume neither navigates to Mis viajes nor shows the notice (login belongs to the http client)", async () => {
    const { lifecycle, resume } = fakeLifecycle();
    const get = vi.fn().mockResolvedValueOnce({ ok: true, value: fixtureFor(A) }).mockResolvedValue({ ok: false, error: { kind: "unauthorized" } });
    await render(`/trips/${A}/itinerary`, { lifecycle, trips: { list: vi.fn().mockResolvedValue({ ok: true, value: [] }), get: vi.fn(async (id: string) => detail(id)) } as never, itinerary: { get } as never });
    await resume(); await settle();
    expect(here.path).toBe(`/trips/${A}/itinerary`);
    expect(text()).not.toContain("Ya no tenés acceso");
  });
});
