// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { itineraryId } from "../trips/itinerary-test-fixture.js";
import { NotificationsScreen } from "./NotificationsScreen.js";
import type { TripNotification } from "./trip-notification-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); vi.restoreAllMocks(); });

const trip = itineraryId(1);
const at = "2026-11-10T10:00:00.000Z";
const base = { tripId: trip, actorId: itineraryId(5), createdAt: at };
const post = (n: number): TripNotification => ({ ...base, id: itineraryId(n), type: "post.created", payload: { postId: itineraryId(100 + n), actorId: itineraryId(5), activityId: null } });
const comment = (n: number): TripNotification => ({ ...base, id: itineraryId(n), type: "comment.created", payload: { commentId: itineraryId(300 + n), postId: itineraryId(100 + n), actorId: itineraryId(5) } });
const created = (n: number): TripNotification => ({ ...base, id: itineraryId(n), type: "activity.created", payload: { activityId: itineraryId(200 + n), actorId: itineraryId(5), scheduledAt: at, durationMinutes: 60 } });
const joined = (n: number): TripNotification => ({ ...base, id: itineraryId(n), type: "member.joined", payload: { memberId: itineraryId(400 + n), userId: itineraryId(401) } });
const expelled = (n: number): TripNotification => ({ ...base, actorId: null, id: itineraryId(n), type: "member.expelled", payload: { tripId: trip } });
const unlinked = (n: number): TripNotification => ({ ...base, id: itineraryId(n), type: "activity.participant_unlinked", payload: {
  activityId: itineraryId(200 + n), reason: "schedule_conflict", changedFields: ["scheduledAt", "durationMinutes"], changedAt: at,
  newInterval: { startsAt: at, durationMinutes: 60, endsAt: "2026-11-10T11:00:00.000Z" },
  incompatibleActivities: [{ activityId: itineraryId(500), reason: "overlap", scheduledAt: at, durationMinutes: 30 }, { activityId: itineraryId(501), reason: "same_start", scheduledAt: at, durationMinutes: null }] } });
const page = (items: TripNotification[], nextCursor: string | null) => ({ ok: true as const, value: { notifications: items, nextCursor } });
const fail = (kind: string) => ({ ok: false as const, error: { kind } });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

let here: { pathname: string; search: string; state: unknown } = { pathname: "", search: "", state: undefined };
function Where() { const location = useLocation(); here = { pathname: location.pathname, search: location.search, state: location.state }; return null; }
async function mount(list: ReturnType<typeof vi.fn>, options: { signal?: number; timeZone?: string } = {}) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={["/notifications"]}><Where />
    <Routes><Route path="/notifications" element={<NotificationsScreen notifications={{ list: list as never }} timeZone={options.timeZone ?? "UTC"} refreshSignal={options.signal} />} />
      <Route path="*" element={<p>otra pantalla</p>} /></Routes></MemoryRouter>));
  return container;
}
const alerts = () => document.querySelectorAll('[role="alert"]');
const byText = (text: string, selector = "button, a") => [...document.querySelectorAll<HTMLElement>(selector)].find((element) => element.textContent?.trim() === text);
const click = (element: Element | undefined) => act(async () => { element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
const flush = () => act(async () => { await Promise.resolve(); });

describe("NotificationsScreen", () => {
  it("shows a loading state, then the notices in the server order, and focuses the heading", async () => {
    const answer = deferred<unknown>();
    await mount(vi.fn().mockReturnValue(answer.promise));
    expect(document.body.textContent).toContain("Cargando avisos");
    await act(async () => answer.resolve(page([comment(3), post(2), created(1)], null)));
    const items = [...document.querySelectorAll("li")].map((li) => li.textContent ?? "");
    expect(items).toHaveLength(3);
    expect(items[0]).toContain("Nuevo comentario en un recuerdo");
    expect(items[1]).toContain("Hay un recuerdo nuevo");
    expect(items[2]).toContain("Se creó una actividad");
    const heading = document.querySelector("h1")!;
    expect(heading.textContent).toBe("Avisos");
    expect(heading.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(heading);
    expect(alerts()).toHaveLength(0);
  });

  it("shows when each notice arrived in the injected zone", async () => {
    await mount(vi.fn().mockResolvedValue(page([post(1)], null)), { timeZone: "America/Argentina/Buenos_Aires" });
    expect(document.querySelector("li time")!.textContent).toContain("07:00");
    expect(document.querySelector("li time")!.getAttribute("datetime")).toBe(at);
  });

  it("an empty inbox says so and offers the way back to the Trips", async () => {
    await mount(vi.fn().mockResolvedValue(page([], null)));
    expect(document.body.textContent).toContain("Todavía no tenés avisos");
    expect(byText("Volver a mis viajes")!.getAttribute("href")).toBe("/trips");
    expect(alerts()).toHaveLength(0);
  });

  it("an initial failure shows one alert with «Reintentar», which loads again", async () => {
    const list = vi.fn().mockResolvedValueOnce(fail("network")).mockResolvedValueOnce(page([post(1)], null));
    await mount(list);
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]!.textContent).toContain("No pudimos cargar tus avisos");
    await click(byText("Reintentar"));
    expect(list).toHaveBeenCalledTimes(2);
    expect(alerts()).toHaveLength(0);
    expect(document.querySelectorAll("li")).toHaveLength(1);
  });

  it("an expired session says so and links to the login without leaking data", async () => {
    await mount(vi.fn().mockResolvedValue(fail("unauthorized")));
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]!.textContent).toContain("Tu sesión venció");
    expect(byText("Iniciar sesión")!.getAttribute("href")).toBe("/login");
    expect(byText("Reintentar")).toBeUndefined();
    expect(document.querySelectorAll("li")).toHaveLength(0);
  });

  it("«Cargar más» appends the next page without duplicates and keeps the focus while it loads", async () => {
    const more = deferred<unknown>();
    const list = vi.fn().mockResolvedValueOnce(page([post(3), post(2)], "c1")).mockReturnValueOnce(more.promise);
    await mount(list);
    const button = byText("Cargar más")!;
    act(() => button.focus());
    await click(button);
    expect(list).toHaveBeenLastCalledWith({ cursor: "c1" });
    const loading = byText("Cargar más")!;
    expect(loading.getAttribute("aria-disabled")).toBe("true");
    expect(loading.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(loading);
    await click(loading);
    expect(list).toHaveBeenCalledTimes(2);
    await act(async () => more.resolve(page([post(2), post(1)], null)));
    expect(document.querySelectorAll("li")).toHaveLength(3);
    expect(byText("Cargar más")).toBeUndefined();
  });

  it("a failed «Cargar más» keeps the list, shows a single alert and retries", async () => {
    const list = vi.fn().mockResolvedValueOnce(page([post(2)], "c1")).mockResolvedValueOnce(fail("server")).mockResolvedValueOnce(page([post(1)], null));
    await mount(list);
    await click(byText("Cargar más"));
    expect(alerts()).toHaveLength(1);
    expect(document.querySelectorAll("li")).toHaveLength(1);
    await click(byText("Reintentar"));
    expect(document.querySelectorAll("li")).toHaveLength(2);
    expect(alerts()).toHaveLength(0);
  });

  it("returning to the foreground refreshes and conserves what was loaded; a failed refresh shows one alert", async () => {
    const list = vi.fn().mockResolvedValueOnce(page([post(2)], null)).mockResolvedValueOnce(page([post(3), post(2)], null)).mockResolvedValueOnce(fail("network"));
    await mount(list);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(document.querySelectorAll("li")).toHaveLength(2);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10_000);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(document.querySelectorAll("li")).toHaveLength(2);
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]!.textContent).toContain("No pudimos actualizar");
  });

  it("a refresh signal (a notice that arrived in the foreground) reloads the list", async () => {
    const list = vi.fn().mockResolvedValueOnce(page([post(2)], null)).mockResolvedValueOnce(page([post(3), post(2)], null));
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); roots.push(root);
    const render = (signal: number) => act(async () => root.render(<MemoryRouter><NotificationsScreen notifications={{ list: list as never }} timeZone="UTC" refreshSignal={signal} /></MemoryRouter>));
    await render(0);
    await render(1);
    expect(list).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll("li")).toHaveLength(2);
  });

  it("each notice opens its exact resource keeping the notices center as origin", async () => {
    await mount(vi.fn().mockResolvedValue(page([comment(3), post(2), created(1), joined(4)], null)));
    const links = [...document.querySelectorAll("li a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual([`/trips/${trip}/memories/${itineraryId(103)}`, `/trips/${trip}/memories/${itineraryId(102)}`,
      `/trips/${trip}/itinerary?activity=${itineraryId(201)}`, `/trips/${trip}/members`]);
    await click(byText("Abrir actividad"));
    expect(here.pathname).toBe(`/trips/${trip}/itinerary`);
    expect(here.search).toBe(`?activity=${itineraryId(201)}`);
    expect(here.state).toEqual({ origin: { path: "/notifications", label: "avisos" } });
  });

  it("an expulsion notice is plain text: no link and nothing of the Trip is opened", async () => {
    await mount(vi.fn().mockResolvedValue(page([expelled(1)], null)));
    const item = document.querySelector("li")!;
    expect(item.textContent).toContain("Ya no sos parte de este viaje");
    expect(item.querySelector("a, button")).toBeNull();
  });

  it("an unlinked participation tells the reason, the new schedule, the duration and links every incompatible plan", async () => {
    await mount(vi.fn().mockResolvedValue(page([unlinked(1)], null)));
    const item = document.querySelector("li")!;
    const text = item.textContent ?? "";
    expect(text).toContain("Cambió el horario y se superpone con otro plan. Se retiró tu participación; revisá la actividad y elegí de nuevo.");
    expect(text).toContain("Nuevo horario");
    expect(text).toContain("Duración: 1 h");
    expect(text).toContain("Cambió la duración.");
    expect(text).toContain("El aviso no cambia tu respuesta.");
    expect(text).toContain("Se superpone");
    expect(text).toContain("Mismo horario");
    const hrefs = [...item.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(`/trips/${trip}/itinerary?activity=${itineraryId(201)}`);
    expect(hrefs).toContain(`/trips/${trip}/itinerary?activity=${itineraryId(500)}`);
    expect(hrefs).toContain(`/trips/${trip}/itinerary?activity=${itineraryId(501)}`);
    expect(byText("Revisar y decidir")!.getAttribute("href")).toBe(`/trips/${trip}/itinerary?activity=${itineraryId(201)}`);
    await click(byText("Revisar y decidir"));
    expect(here.state).toEqual({ origin: { path: "/notifications", label: "avisos" } });
  });

  it("works without any push service or permission: the screen only needs the inbox api", async () => {
    const original = (globalThis as { Notification?: unknown }).Notification;
    vi.stubGlobal("Notification", undefined);
    await mount(vi.fn().mockResolvedValue(page([post(1)], null)));
    expect(document.querySelectorAll("li")).toHaveLength(1);
    vi.unstubAllGlobals();
    if (original) (globalThis as { Notification?: unknown }).Notification = original;
  });

  it("opening the list never asks for anything but the inbox", async () => {
    const list = vi.fn().mockResolvedValue(page([unlinked(1)], null));
    await mount(list);
    await flush();
    expect(list).toHaveBeenCalledTimes(1);
  });
});
