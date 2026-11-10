// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { itineraryFixture, itineraryId } from "./itinerary-test-fixture.js";
import { MemoriesLayout, TripMemoriesScreen } from "./TripMemoriesScreen.js";
import { TripItineraryScreen } from "./TripItineraryScreen.js";
import { TripMembersScreen } from "./TripMembersScreen.js";
import { TripPhotosScreen } from "./TripPhotosScreen.js";
import { ShellFrame } from "./trip-context.js";
import { GalleryProvider } from "./use-gallery.js";
import type { TripItineraryResponse } from "./trip-itinerary-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
beforeEach(() => { window.scrollTo = vi.fn() as never; Element.prototype.scrollIntoView = vi.fn(); });

const tripId = itineraryId(1);
const me = itineraryId(600);
const admin = { id: itineraryId(901), userId: me, name: "Nico", role: "admin", joinedAt: "2026-09-24T12:00:00.000Z" };
const other = { id: itineraryId(902), userId: itineraryId(601), name: "Ana", role: "participant", joinedAt: "2026-09-24T13:00:00.000Z" };
const trip = { kind: "member", id: tripId, name: "Patagonia", description: null, primaryDestination: { name: "Bariloche" }, visibility: "private", inviteCode: "VIAJE-X7K2", expenseMode: "register" };
const members = { list: vi.fn().mockResolvedValue({ ok: true, value: { members: [admin, other], currentUserId: me } }), expel: vi.fn() };

async function mount(path: string, element: ReactElement, inShell: boolean) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const screen = inShell ? <><h1>Patagonia</h1><ShellFrame>{element}</ShellFrame></> : element;
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/trips/:tripId/memories" element={<MemoriesLayout />}><Route index element={screen} /></Route>
    <Route path="/trips/:tripId/*" element={screen} />
  </Routes></MemoryRouter>));
  return container;
}
const levels = (container: HTMLElement) => [...container.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => ({ level: Number(h.tagName[1]), text: h.textContent ?? "" }));
/** Every heading is at most one level deeper than the previous one (no skips) and there is exactly one h1. */
const expectNoSkips = (container: HTMLElement) => {
  const list = levels(container);
  expect(list.filter((h) => h.level === 1)).toHaveLength(1);
  list.forEach((h, index) => { if (index > 0) expect(h.level, `${h.text} after ${list[index - 1]!.text}`).toBeLessThanOrEqual(list[index - 1]!.level + 1); });
};
const levelOf = (container: HTMLElement, text: string) => levels(container).find((h) => h.text === text)?.level;

const itineraryElement = (value: TripItineraryResponse = itineraryFixture() as TripItineraryResponse) =>
  <TripItineraryScreen itinerary={{ get: vi.fn().mockResolvedValue({ ok: true, value }) }} timeZone="UTC" />;
const membersElement = <TripMembersScreen trips={{ get: vi.fn().mockResolvedValue({ ok: true, value: trip }), deleteTrip: vi.fn() } as never}
  members={members as never} apiBaseUrl="https://api.example.test" sharing={{ copyText: vi.fn() }} />;

describe("heading hierarchy inside the Trip shell", () => {
  it("members: the screen is h2 and its sections h3, with no skips; without the shell it stays h1 > h2", async () => {
    const inside = await mount(`/trips/${tripId}/members`, membersElement, true);
    expect(levelOf(inside, "Miembros e invitación")).toBe(2);
    for (const text of ["Invitar al viaje", "Integrantes", "Administración"]) expect(levelOf(inside, text), text).toBe(3);
    expect(levelOf(inside, "Eliminar viaje")).toBe(4);
    expectNoSkips(inside);
    await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren();
    const outside = await mount(`/trips/${tripId}/members`, membersElement, false);
    expect(levelOf(outside, "Miembros e invitación")).toBe(1);
    for (const text of ["Invitar al viaje", "Integrantes", "Administración"]) expect(levelOf(outside, text), text).toBe(2);
    expect(levelOf(outside, "Eliminar viaje")).toBe(3);
    expectNoSkips(outside);
  });
  it("itinerary: Itinerario h2, day h3, band h4, item h5, no skips; without the shell h1 > h2 > h3 > h4", async () => {
    const inside = await mount(`/trips/${tripId}/itinerary`, itineraryElement(), true);
    expect(levelOf(inside, "Itinerario")).toBe(2);
    const days = [...inside.querySelectorAll("section.itinerary-day > h3,section.itinerary-day > h2")];
    expect(days.length).toBeGreaterThan(0);
    days.forEach((day) => expect(day.tagName).toBe("H3"));
    inside.querySelectorAll(".itinerary-band-header h3,.itinerary-band-header h4").forEach((band) => expect(band.tagName).toBe("H4"));
    inside.querySelectorAll(".itinerary-item h4,.itinerary-item h5").forEach((title) => expect(title.tagName).toBe("H5"));
    expect(inside.querySelectorAll(".itinerary-item h5").length).toBeGreaterThan(0);
    expectNoSkips(inside);
    await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren();
    const outside = await mount(`/trips/${tripId}/itinerary`, itineraryElement(), false);
    expect(outside.querySelector("section.itinerary-day > h2")).not.toBeNull();
    expect(outside.querySelector(".itinerary-band-header h3")).not.toBeNull();
    expect(outside.querySelector(".itinerary-item h4")).not.toBeNull();
  });
  it("itinerary without days: the empty state is h3 under the h2", async () => {
    const empty = { ...(itineraryFixture() as TripItineraryResponse), days: [] };
    const inside = await mount(`/trips/${tripId}/itinerary`, itineraryElement(empty), true);
    expect(levelOf(inside, "Todavía no hay itinerario")).toBe(3);
    expectNoSkips(inside);
  });
  it("memories: Recuerdos h2 and the empty state h3", async () => {
    const element = <TripMemoriesScreen posts={{ list: vi.fn().mockResolvedValue({ ok: true, value: [] }) }} timeZone="UTC" />;
    const inside = await mount(`/trips/${tripId}/memories`, element, true);
    expect(levelOf(inside, "Recuerdos")).toBe(2);
    expect(levelOf(inside, "Todavía no hay recuerdos.")).toBe(3);
    expectNoSkips(inside);
  });
  it("photos: Fotos h2 and the empty state h3", async () => {
    const element = <GalleryProvider list={vi.fn().mockResolvedValue({ ok: true, value: { photos: [], nextCursor: null } }) as never}>
      <TripPhotosScreen members={members as never} timeZone="UTC" /></GalleryProvider>;
    const inside = await mount(`/trips/${tripId}/memories`, element, true);
    expect(levelOf(inside, "Fotos")).toBe(2);
    expect(levelOf(inside, "Todavía no hay fotos")).toBe(3);
    expectNoSkips(inside);
  });
});
