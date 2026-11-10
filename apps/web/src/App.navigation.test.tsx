// @vitest-environment jsdom
// Navigation of the Trip as a whole (T98): the shell with its tabs, details opened outside them and the way back, with the real App and the router history.
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.js";
import { itineraryFixture, itineraryId, linkPost } from "./trips/itinerary-test-fixture.js";
import type { TripItineraryResponse } from "./trips/trip-itinerary-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
let scrollIntoView: ReturnType<typeof vi.fn>;
beforeEach(() => { scrollIntoView = vi.fn(); Element.prototype.scrollIntoView = scrollIntoView as never; window.scrollTo = vi.fn() as never; });
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); vi.unstubAllGlobals(); });

const A = itineraryId(1), B = itineraryId(2), me = itineraryId(20);
const ACT1 = itineraryId(8), ACT2 = itineraryId(9), POST = itineraryId(10), TRANSPORT = itineraryId(6), PHOTO = itineraryId(40);
const at = (day: number, hour: number) => `2026-09-${day}T${String(hour).padStart(2, "0")}:00:00.000Z`;
const storage = () => ({ read: vi.fn().mockResolvedValue({ accessToken: "old", refreshToken: "refresh" }), save: vi.fn().mockResolvedValue(undefined), clear: vi.fn().mockResolvedValue(undefined) });
const auth = { refresh: vi.fn().mockResolvedValue({ ok: true, value: { accessToken: "access", refreshToken: "refresh" } }) };

/** Days 25 to 28 (UTC). Activity 2 is on the 26th and carries the memory POST; transport 6 leaves on the 25th and carries memory 11. */
function itineraryOf(tripId: string): TripItineraryResponse {
  const value = structuredClone(itineraryFixture()) as TripItineraryResponse;
  value.tripId = tripId;
  value.days[0]!.startsAt = at(25, 8); value.days[0]!.endsAt = at(25, 10);
  value.days[1]!.startsAt = at(25, 10); value.days[1]!.endsAt = at(28, 18);
  value.days[2]!.startsAt = at(28, 18); value.days[2]!.endsAt = at(28, 20);
  value.transports[0]!.departureAt = at(25, 8); value.transports[0]!.arrivalAt = at(25, 10);
  value.transports[1]!.departureAt = at(28, 18); value.transports[1]!.arrivalAt = at(28, 20);
  value.activities[1]!.scheduledAt = at(26, 14);
  value.days[1]!.items = value.activities.map((activity) => ({ kind: "activity", id: activity.id, at: activity.scheduledAt }));
  value.posts[0]!.createdAt = at(26, 15);
  linkPost(value.posts[0]!, { activityId: ACT2 });
  value.activities[1]!.postIds = [POST];
  return value;
}
const photoOf = (tripId: string, id = PHOTO): Record<string, unknown> => ({ id, postId: POST, order: 0, uploadedAt: at(26, 16), uploaderId: me, url: `https://s3.test/${tripId}/${id}?sig=x`,
  expiresAtMs: Date.parse("2100-01-01T00:00:00.000Z"), post: { createdAt: at(26, 15), authorId: me, rootActivityId: ACT2, rootTransportId: null } });
const tripDetail = (id: string, name: string) => ({ ok: true as const, value: { id, kind: "member" as const, name, description: null, primaryDestination: { name: "Córdoba" }, visibility: "private", inviteCode: "ABC123", expenseMode: "register" } });
const postOf = (id: string, description: string, extra: Record<string, unknown> = {}) => ({ id, tripId: A, authorId: me, description, mapsUrl: null, activityId: null, transportId: null, parentPostId: null, createdAt: at(26, 15),
  context: { parentPostId: null, rootPostId: id, rootActivityId: null, rootTransportId: null, placement: "independent" }, expense: null, ...extra });

function props(over: Partial<ComponentProps<typeof App>> = {}): ComponentProps<typeof App> {
  return {
    auth, sessionStorage: storage(),
    trips: { list: vi.fn().mockResolvedValue({ ok: true, value: [] }), get: vi.fn().mockImplementation(async (id: string) => tripDetail(id, id === A ? "Patagonia" : "Lisboa")) },
    itinerary: { get: vi.fn().mockImplementation(async (id: string) => ({ ok: true, value: itineraryOf(id) })) },
    activities: { get: vi.fn().mockImplementation(async (id: string, activityId: string) => ({ ok: true, value: itineraryOf(id).activities.find((a) => a.id === activityId) })) },
    members: { list: vi.fn().mockResolvedValue({ ok: true, value: { currentUserId: me, members: [{ id: itineraryId(60), userId: me, name: "Yo", role: "admin", joinedAt: at(20, 10) }] } }) },
    posts: {
      list: vi.fn().mockResolvedValue({ ok: true, value: [postOf(itineraryId(11), "Segundo recuerdo"), postOf(POST, "Primer recuerdo")] }),
      get: vi.fn().mockImplementation(async (_t: string, id: string) => ({ ok: true, value: { post: postOf(id, "Detalle", id === POST ? { activityId: ACT2 } : { transportId: TRANSPORT }),
        parent: null, children: [], rootActivityId: id === POST ? ACT2 : null } })),
    },
    gallery: { list: vi.fn().mockImplementation(async (id: string) => ({ ok: true, value: { photos: [photoOf(id)], nextCursor: null } })) },
    ...over,
  } as unknown as ComponentProps<typeof App>;
}

let go: NavigateFunction = () => undefined;
let here = { path: "", state: null as unknown };
function Spy() { go = useNavigate(); const l = useLocation(); here = { path: `${l.pathname}${l.search}`, state: l.state }; return null; }
async function render(entries: string[], app: ComponentProps<typeof App>) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}><Spy /><App {...app} /></MemoryRouter>));
  await settle();
  return container;
}
const settle = async () => { for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); }); };
const click = async (element: Element | null | undefined) => { expect(element).toBeTruthy(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }))); await settle(); };
const back = async () => { await act(async () => go(-1)); await settle(); };
const named = (selector: string, text: string, root: ParentNode = document) => Array.from(root.querySelectorAll(selector)).find((item) => item.textContent === text);
const tab = (label: string) => named("[role=tab]", label);
const selectedTabs = () => [...document.querySelectorAll("[role=tab][aria-selected=true]")].map((item) => item.textContent);
const day = (date: string) => document.querySelector<HTMLElement>(`[data-day="${date}"]`);
const shownDays = () => [...document.querySelectorAll("[data-itinerary-date]")].map((item) => item.getAttribute("data-itinerary-date"));
const heading = () => document.querySelector("main h1")?.textContent;
const dialog = () => document.querySelector(".activity-dialog, .transport-dialog");

describe("Trip tabs and the way back", () => {
  it("Grupo: Back from the group leaves to Mis viajes", async () => {
    await render(["/trips", `/trips/${A}/members`], props());
    expect(selectedTabs()).toEqual(["Grupo"]);
    expect(document.body.textContent).toContain("Miembros e invitación");
    await back();
    expect(here.path).toBe("/trips");
    expect(document.querySelector(".trip-shell-header")).toBeNull();
  });
  it("Grupo: Itinerario, Diario and Grupo are reached in place; one Back from any of them leaves to Mis viajes", async () => {
    await render(["/trips", `/trips/${A}/itinerary`], props());
    expect(heading()).toBe("Patagonia");
    await click(tab("Grupo"));
    expect(here.path).toBe(`/trips/${A}/members`);
    expect(document.body.textContent).toContain("Integrantes");
    await click(tab("Diario"));
    expect(here.path).toBe(`/trips/${A}/memories`);
    expect(selectedTabs()).toEqual(["Diario", "Posts"]);
    await click(tab("Itinerario"));
    expect(here.path).toBe(`/trips/${A}/itinerary`);
    await back();
    expect(here.path).toBe("/trips");
  });
  it("recuerdo: opening a memory and going back with the device Back restores the same item (anchor, scroll and focus)", async () => {
    await render(["/trips", `/trips/${A}/memories`], props());
    const row = () => document.querySelector<HTMLElement>(`[data-memory="${POST}"]`);
    expect(row()).not.toBeNull();
    await click(row()!.querySelector("a"));
    expect(here.path).toBe(`/trips/${A}/memories/${POST}`);
    expect(document.querySelector(".trip-shell-header")).toBeNull(); // the detail opens outside the tabs
    scrollIntoView.mockClear();
    await back();
    expect(here.path).toBe(`/trips/${A}/memories`);
    expect(selectedTabs()).toEqual(["Diario", "Posts"]);
    expect(scrollIntoView.mock.contexts).toContain(row());
    expect(document.activeElement).toBe(row());
  });
  it("fotos: viewer, «Ver recuerdo» and Back reopen the viewer on the same photo without asking again", async () => {
    const app = props();
    await render(["/trips", `/trips/${A}/memories`], app);
    await click(tab("Fotos"));
    expect(here.path).toBe(`/trips/${A}/memories/photos`);
    await click(document.querySelector(`[data-photo="${PHOTO}"] button`));
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("Foto 1 de 1");
    await click(named("a", "Ver recuerdo"));
    expect(here.path).toBe(`/trips/${A}/memories/${POST}`);
    await back();
    expect(here.path).toBe(`/trips/${A}/memories/photos`);
    expect(selectedTabs()).toEqual(["Diario", "Fotos"]);
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("Foto 1 de 1");
    expect(app.gallery!.list).toHaveBeenCalledTimes(1);
    await click(document.querySelector('[aria-label="Cerrar"]'));
    await back();
    expect(here.path).toBe("/trips");
  });
  it("actividad: day, dialog, memory and Back return to the dialog of the same day", async () => {
    await render(["/trips", `/trips/${A}/itinerary`], props());
    await click(day("2026-09-26"));
    expect(shownDays()).toEqual(["2026-09-26"]);
    await click(document.querySelector(`[data-itinerary-item="${ACT2}"] button.activity-title`));
    expect(dialog()).not.toBeNull();
    const memory = () => document.querySelector<HTMLElement>(`[data-memory="${POST}"]`);
    expect(memory()).not.toBeNull();
    await click(memory()!.querySelector("a"));
    expect(here.path).toBe(`/trips/${A}/memories/${POST}`);
    await back();
    expect(here.path).toBe(`/trips/${A}/itinerary?day=2026-09-26&activity=${ACT2}`);
    expect(dialog()).not.toBeNull();
    expect(shownDays()).toEqual(["2026-09-26"]);
    expect(day("2026-09-26")!.getAttribute("aria-current")).toBe("date");
    expect(document.activeElement).toBe(memory());
    await back(); // closes the dialog on the same day
    expect(dialog()).toBeNull();
    expect(here.path).toBe(`/trips/${A}/itinerary?day=2026-09-26`);
    expect(shownDays()).toEqual(["2026-09-26"]);
    await back();
    expect(here.path).toBe("/trips");
  });
  it("transporte: dialog, «Compartir un recuerdo» and Back return to the dialog", async () => {
    await render(["/trips", `/trips/${A}/itinerary`], props());
    await click(document.querySelector(`[data-itinerary-item="${TRANSPORT}"] button.transport-title`));
    expect(dialog()).not.toBeNull();
    await click(named("a", "Compartir un recuerdo"));
    expect(here.path).toContain(`/trips/${A}/memories/new`);
    expect(document.querySelector(".trip-shell-header")).toBeNull();
    await back();
    expect(here.path).toBe(`/trips/${A}/itinerary?transport=${TRANSPORT}`);
    expect(dialog()).not.toBeNull();
  });
  it("transporte: a memory linked to a transport leads to it with «Ver transporte» and Back returns to the memory", async () => {
    await render(["/trips", `/trips/${A}/memories`], props());
    await click(document.querySelector(`[data-memory="${itineraryId(11)}"] a`));
    expect(here.path).toBe(`/trips/${A}/memories/${itineraryId(11)}`);
    await click(named("a", "Ver transporte"));
    expect(here.path).toBe(`/trips/${A}/itinerary?transport=${TRANSPORT}`);
    expect(dialog()).not.toBeNull();
    await back();
    expect(here.path).toBe(`/trips/${A}/memories/${itineraryId(11)}`);
    expect(document.querySelector("h1")?.textContent).toBe("Recuerdo");
  });
});

describe("a resource that is gone or no longer allowed opens nothing else", () => {
  it("an activity or transport that no longer exists is cleaned from the URL with no dialog and no other detail requested", async () => {
    const app = props();
    await render(["/trips", `/trips/${A}/itinerary?day=2026-09-26&activity=${itineraryId(777)}`], app);
    expect(dialog()).toBeNull();
    expect(here.path).toBe(`/trips/${A}/itinerary?day=2026-09-26`);
    expect(shownDays()).toEqual(["2026-09-26"]);
    // The dialog may ask for the id of the URL once before the itinerary says it is gone, never for another activity.
    expect((app.activities!.get as ReturnType<typeof vi.fn>).mock.calls.every(([, id]) => id === itineraryId(777))).toBe(true);
    await act(async () => go(`/trips/${A}/itinerary?transport=${itineraryId(778)}`, { replace: true }));
    await settle();
    expect(dialog()).toBeNull();
    expect(here.path).toBe(`/trips/${A}/itinerary`);
  });
  it("a Trip whose access was revoked shows no itinerary, no dialog and never reaches another Trip's data", async () => {
    const itinerary = { get: vi.fn().mockResolvedValue({ ok: false, error: { kind: "forbidden" } }) };
    const app = props({ itinerary });
    await render(["/trips", `/trips/${A}/itinerary?activity=${ACT1}`], app);
    expect(document.body.textContent).toContain("no está disponible");
    expect(dialog()).toBeNull();
    expect(document.querySelector("[data-day]")).toBeNull();
    expect(app.activities!.get).not.toHaveBeenCalled();
    expect(itinerary.get).toHaveBeenCalledWith(A);
    expect(itinerary.get).not.toHaveBeenCalledWith(B);
  });
  it("a memory that is no longer available says so and keeps Back to the diary", async () => {
    const app = props({ posts: { list: vi.fn().mockResolvedValue({ ok: true, value: [postOf(POST, "Primer recuerdo")] }), get: vi.fn().mockResolvedValue({ ok: false, error: { kind: "forbidden" } }) } });
    await render(["/trips", `/trips/${A}/memories`], app);
    await click(document.querySelector(`[data-memory="${POST}"] a`));
    expect(document.body.textContent).toContain("ya no está disponible");
    await back();
    expect(here.path).toBe(`/trips/${A}/memories`);
  });
});

describe("changing Trip does not reuse the state of the previous one", () => {
  it("does not keep the name, the day or the gallery of Trip A in Trip B", async () => {
    const itineraryGet = vi.fn().mockImplementation(async (id: string) => ({ ok: true, value: itineraryOf(id) }));
    const app = props({ itinerary: { get: itineraryGet } });
    await render(["/trips", `/trips/${A}/itinerary?day=2026-09-27`], app);
    expect(heading()).toBe("Patagonia");
    expect(shownDays()).toEqual(["2026-09-27"]);
    let resolveName!: (value: unknown) => void;
    (app.trips!.get as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise((resolve) => { resolveName = resolve; }));
    await act(async () => go(`/trips/${B}/itinerary`));
    await settle();
    expect(heading()).toBe("Viaje"); // not «Patagonia» while Lisboa loads
    expect(shownDays()).toEqual(["2026-09-25"]);
    await act(async () => resolveName(tripDetail(B, "Lisboa")));
    expect(heading()).toBe("Lisboa");
    await click(tab("Diario")); await click(tab("Fotos"));
    expect(app.gallery!.list).toHaveBeenCalledWith(B, {});
    expect(document.querySelector(`[data-photo="${PHOTO}"] img`)?.getAttribute("src")).toContain(`/${B}/`);
    expect(document.body.innerHTML).not.toContain(`/${A}/`);
  });
  it("starts the composer of Trip B empty and does not take the participation of Trip A", async () => {
    const get = vi.fn().mockImplementation(async (tripId: string, activityId: string) => ({ ok: true,
      value: tripId === A && activityId === ACT1 ? { id: itineraryId(50), tripId, activityId, userId: me, status: "going", updatedAt: at(25, 12) } : null }));
    const app = props({ participations: { get, set: vi.fn() } });
    await render(["/trips", `/trips/${A}/itinerary`], app);
    expect(document.querySelector(`[data-itinerary-item="${ACT1}"] [aria-pressed="true"]`)?.textContent).toBe("Voy");
    await act(async () => go(`/trips/${B}/itinerary`)); await settle();
    expect(get).toHaveBeenCalledWith(B, ACT1);
    expect(document.querySelector(`[data-itinerary-item="${ACT1}"] [aria-pressed="true"]`)).toBeNull();
    expect(document.querySelector(`[data-itinerary-item="${ACT1}"] .activity-participation-status`)?.textContent).toBe("Sin responder");
    await act(async () => go(`/trips/${A}/memories/new`)); await settle();
    const field = document.querySelector<HTMLTextAreaElement>('[name="description"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Borrador de A"); field.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(document.querySelector<HTMLTextAreaElement>('[name="description"]')!.value).toBe("Borrador de A");
    await act(async () => go(`/trips/${B}/memories/new`)); await settle();
    expect(document.querySelector<HTMLTextAreaElement>('[name="description"]')!.value).toBe("");
  });
});

describe("system Back (native port simulated)", () => {
  const fakeBack = () => {
    let listener: ((event: { canGoBack: boolean }) => void) | undefined;
    const remove = vi.fn().mockResolvedValue(undefined);
    return { port: { addListener: vi.fn(async (_n: "backButton", fn: (event: { canGoBack: boolean }) => void) => { listener = fn; return { remove }; }), exitApp: vi.fn().mockResolvedValue(undefined) },
      press: (canGoBack: boolean) => act(async () => listener!({ canGoBack })) };
  };
  it("Back from a Trip root opened as the first entry (deep link) goes to Mis viajes and then exits the app", async () => {
    const back = fakeBack();
    await render([`/trips/${A}/itinerary`], props({ nativeBack: back.port }));
    await back.press(false);
    expect(here.path).toBe("/trips");
    expect(back.port.exitApp).not.toHaveBeenCalled();
    await back.press(false);
    expect(back.port.exitApp).toHaveBeenCalledTimes(1);
    expect(back.port.addListener).toHaveBeenCalledTimes(1);
  });
});
