// @vitest-environment jsdom
import { NativeCapabilityError, err, ok, type NativePushHandlers, type NativePushNotification, type PushRegistrationPort } from "app-domain";
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  camera: { requestPermissions: vi.fn(), checkPermissions: vi.fn(), takePhoto: vi.fn(), chooseFromGallery: vi.fn(), pickImages: vi.fn() },
  push: { requestPermissions: vi.fn(), checkPermissions: vi.fn(), register: vi.fn(), unregister: vi.fn(), addListener: vi.fn() },
  calendar: { requestPermissions: vi.fn(), checkPermissions: vi.fn() },
}));
vi.mock("@capacitor/camera", () => ({ Camera: native.camera }));
vi.mock("@capacitor/push-notifications", () => ({ PushNotifications: native.push }));
vi.mock("@capacitor/calendar", () => ({ Calendar: native.calendar }));

import App from "./App.js";
import type { PushDeviceService, PushStatus } from "./push/push-device-service.js";
import { itineraryFixture, itineraryId } from "./trips/itinerary-test-fixture.js";
import type { PostDetail } from "./trips/trip-post-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

const tripId = itineraryId(1), activityId = itineraryId(8), postId = itineraryId(30);
const at = "2026-11-10T10:00:00.000Z";
const notice = (n: number, type: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ id: itineraryId(500 + n), type, tripId, actorId: itineraryId(20), payload, createdAt: at, ...extra });
const activityNotice = (n = 1, id = activityId) => notice(n, "activity.updated", { activityId: id, actorId: itineraryId(20), changedFields: ["scheduledAt"] });
const postNotice = (n = 2) => notice(n, "post.created", { postId, actorId: itineraryId(20), activityId: null });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const denied = (status: number) => json({ error: { code: status === 404 ? "TripNotFoundError" : "ForbiddenError", message: "SECRETO-NO-EXPONER" } }, status);

type Setup = { notifications?: unknown[]; itinerary?: number; participation?: unknown };
const makeFetch = (setup: Setup = {}) => vi.fn().mockImplementation(async (url: string, request: RequestInit) => {
  const { pathname } = new URL(url);
  if (pathname === "/auth/refresh") return json({ accessToken: "renewed", refreshToken: "refresh" });
  if (pathname === "/auth/login") return json({ accessToken: "login-access", refreshToken: "login-refresh" });
  if (pathname === "/notifications") return json({ notifications: setup.notifications ?? [], nextCursor: null });
  if (pathname === "/trips") return json({ trips: [] });
  if (pathname.endsWith("/itinerary")) return setup.itinerary && setup.itinerary !== 200 ? denied(setup.itinerary) : json({ itinerary: itineraryFixture() });
  if (pathname.endsWith("/participation")) return json({ participation: request.method === "GET" ? setup.participation ?? null : null });
  return json({ error: { code: "NotFound", message: "x" } }, 404);
});
const storage = (hasSession = true) => ({ read: vi.fn().mockResolvedValue(hasSession ? { accessToken: "old", refreshToken: "refresh" } : null), save: vi.fn().mockResolvedValue(undefined), clear: vi.fn().mockResolvedValue(undefined) });
function Path() { const location = useLocation(); return <output data-testid="path">{location.pathname}{location.search}</output>; }
type AppProps = ComponentProps<typeof App>;
async function render(path: string, fetch: ReturnType<typeof vi.fn>, props: Partial<AppProps> = {}, hasSession = true) {
  vi.stubGlobal("fetch", fetch);
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}>
    <App apiBaseUrl="https://api.test" sessionStorage={storage(hasSession)} {...props} /><Path />
  </MemoryRouter>));
  return container;
}
const pathOf = () => document.querySelector("[data-testid=path]")!.textContent;
const find = (selector: string, text: string) => [...document.querySelectorAll<HTMLElement>(selector)].find((element) => element.textContent?.trim() === text);
const click = async (element: Element | undefined | null) => { expect(element).toBeTruthy(); await act(async () => { element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })); }); };
const calls = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls.map(([url, request]) => `${(request as RequestInit | undefined)?.method ?? "GET"} ${new URL(url as string).pathname}`);

const detail = (): PostDetail => ({ post: { id: postId, tripId, authorId: itineraryId(20), description: "Atardecer", mapsUrl: null, activityId: null, parentPostId: null, transportId: null, createdAt: "2026-01-02T15:30:00.000Z" },
  parent: null, children: [], rootActivityId: null });
const postApis = (get: ReturnType<typeof vi.fn>): Partial<AppProps> => ({
  posts: { get } as never, comments: { list: vi.fn().mockResolvedValue({ ok: true, value: [] }) } as never,
  likes: { summary: vi.fn().mockResolvedValue({ ok: true, value: { post: { count: 0, likedByMe: false }, comments: {} } }) } as never,
  members: { list: vi.fn().mockResolvedValue({ ok: true, value: { currentUserId: itineraryId(20), members: [] } }) } as never,
});

describe("App notices center", () => {
  it("is a protected route: without a session it goes to the login and asks for nothing", async () => {
    const fetch = makeFetch({ notifications: [postNotice()] });
    const container = await render("/notifications", fetch, {}, false);
    expect(container.textContent).toContain("Iniciar sesión");
    expect(container.textContent).not.toContain("Hay un recuerdo nuevo");
    expect(calls(fetch).filter((call) => call.includes("/notifications"))).toEqual([]);
  });

  it("lists the notices over HTTP with the restored session", async () => {
    const fetch = makeFetch({ notifications: [postNotice(), activityNotice()] });
    const container = await render("/notifications", fetch);
    expect(container.querySelector("h1")?.textContent).toBe("Avisos");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    const request = fetch.mock.calls.find(([url]) => new URL(url as string).pathname === "/notifications")!;
    expect(request[0]).toBe("https://api.test/notifications");
    expect((request[1] as { headers: Record<string, string> }).headers.Authorization).toBe("Bearer renewed");
  });

  it("is reachable from the Trips list through the provisional «Avisos» link", async () => {
    const fetch = makeFetch({ notifications: [postNotice()] });
    await render("/trips", fetch, { trips: { list: vi.fn().mockResolvedValue({ ok: true, value: [] }) } as never });
    await click(find("a", "Avisos"));
    expect(pathOf()).toBe("/notifications");
    expect(document.querySelectorAll("li")).toHaveLength(1);
  });

  it("opens the activity with the exact id and «Volver a avisos» leads back to the list", async () => {
    const fetch = makeFetch({ notifications: [activityNotice()] });
    await render("/notifications", fetch);
    await click(find("a", "Abrir actividad"));
    expect(pathOf()).toBe(`/trips/${tripId}/itinerary?activity=${activityId}`);
    expect(find("a", "Volver a mis viajes")).toBeUndefined();
    await click(find("a", "Volver a avisos"));
    expect(pathOf()).toBe("/notifications");
    expect(document.querySelectorAll("li")).toHaveLength(1);
  });

  it("opens the post and its «Volver a avisos» leads back to the list", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: detail() });
    await render("/notifications", makeFetch({ notifications: [postNotice()] }), postApis(get));
    await click(find("a", "Abrir recuerdo"));
    expect(pathOf()).toBe(`/trips/${tripId}/memories/${postId}`);
    expect(get).toHaveBeenCalledWith(tripId, postId);
    expect(document.body.textContent).toContain("Atardecer");
    await click(find("a", "Volver a avisos"));
    expect(pathOf()).toBe("/notifications");
  });

  it("an activity that no longer exists shows a generic message, cleans the URL and keeps the way back", async () => {
    await render("/notifications", makeFetch({ notifications: [activityNotice(1, itineraryId(999))] }));
    await click(find("a", "Abrir actividad"));
    expect(document.body.textContent).toContain("La actividad ya no existe.");
    expect(pathOf()).toBe(`/trips/${tripId}/itinerary`);
    expect(find("a", "Volver a avisos")).toBeDefined();
    expect(document.querySelector(".activity-dialog")).toBeNull();
  });

  it.each([403, 404])("a revoked Trip (%i) shows a generic message without data and a safe way back", async (status) => {
    const fetch = makeFetch({ notifications: [activityNotice()], itinerary: status });
    await render("/notifications", fetch);
    await click(find("a", "Abrir actividad"));
    expect(document.body.textContent).toContain("Este itinerario no está disponible para tu cuenta.");
    expect(document.body.textContent).not.toContain("SECRETO");
    expect(document.querySelector("[data-itinerary-item]")).toBeNull();
    expect(find("button", "Reintentar")).toBeUndefined();
    await click(find("a", "Volver a avisos"));
    expect(pathOf()).toBe("/notifications");
  });

  it.each(["not-found", "forbidden"])("a post that is gone or not visible (%s) shows a generic message and the way back to the notices", async (kind) => {
    const get = vi.fn().mockResolvedValue({ ok: false, error: { kind } });
    await render("/notifications", makeFetch({ notifications: [postNotice()] }), postApis(get));
    await click(find("a", "Abrir recuerdo"));
    expect(document.body.textContent).toContain("Este recuerdo ya no está disponible para tu cuenta.");
    expect(document.body.textContent).not.toContain("Atardecer");
    await click(find("a", "Volver a avisos"));
    expect(pathOf()).toBe("/notifications");
  });

  it("an expired session in the center asks to log in again", async () => {
    const fetch = vi.fn().mockImplementation(async (url: string) => {
      const { pathname } = new URL(url);
      if (pathname === "/auth/refresh") return json({ accessToken: "renewed", refreshToken: "refresh" });
      return json({ error: { code: "Unauthorized", message: "x" } }, 401);
    });
    const container = await render("/notifications", fetch);
    expect(container.textContent).toContain("Iniciar sesión");
    expect(container.textContent).not.toContain("Hay un recuerdo nuevo");
  });
});

describe("App notices: reading never changes the participation", () => {
  it("listing, opening and going back never write a participation nor ask the notice to be marked", async () => {
    const fetch = makeFetch({ notifications: [activityNotice()] });
    await render("/notifications", fetch);
    expect(calls(fetch).some((call) => call.includes("/participation"))).toBe(false);
    await click(find("a", "Abrir actividad"));
    await click(find("a", "Volver a avisos"));
    // The only write is the session restore: no participation, no notice mark.
    expect(calls(fetch).filter((call) => call.startsWith("PUT") || call.startsWith("PATCH") || call.startsWith("DELETE") || (call.startsWith("POST") && call !== "POST /auth/refresh"))).toEqual([]);
  });

  const mark = { reason: "schedule_conflict", changedFields: ["scheduledAt"], changedAt: "2026-11-09T10:00:00.000Z" };
  const participation = { id: itineraryId(50), tripId, activityId, userId: itineraryId(20), status: "pending", updatedAt: "2026-11-09T10:00:00.000Z", decisionRequired: mark };
  const service = (status: PushStatus): PushDeviceService => ({ getStatus: () => status, subscribe: () => () => undefined, refreshStatus: vi.fn(async () => undefined), resume: vi.fn(async () => undefined),
    enable: vi.fn(async () => undefined), revokeBeforeLogout: vi.fn(async () => ({ revoked: true })), reset: vi.fn() });
  it.each<PushStatus>([{ state: "denied" }, { state: "unsupported" }, { state: "error" }])("the «Modificado» explanation works with push %o and does not consume the mark", async (status) => {
    const fetch = makeFetch({ participation });
    const push = service(status);
    await render(`/trips/${tripId}/itinerary`, fetch, { push });
    const modified = find("button", "Modificado");
    expect(modified).toBeDefined();
    await click(modified);
    expect(modified!.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector('[aria-label="Cambio en tu participación"]')?.textContent).toContain("Elegí de nuevo si vas o no vas.");
    expect(push.enable).not.toHaveBeenCalled();
    expect(calls(fetch).filter((call) => call.startsWith("PUT"))).toEqual([]);
    expect(find("button", "Modificado")).toBeDefined();
  });

  it("opening the notice of an unlinked participation leaves «Modificado» in the itinerary", async () => {
    const unlinked = notice(1, "activity.participant_unlinked", { activityId, reason: "schedule_conflict", changedFields: ["scheduledAt"], changedAt: at,
      newInterval: { startsAt: at, durationMinutes: null, endsAt: null }, incompatibleActivities: [] });
    const fetch = makeFetch({ notifications: [unlinked], participation });
    await render("/notifications", fetch);
    expect(document.body.textContent).toContain("El aviso no cambia tu respuesta.");
    await click(find("a", "Revisar y decidir"));
    expect(pathOf()).toBe(`/trips/${tripId}/itinerary?activity=${activityId}`);
    expect(find("button", "Modificado")).toBeDefined();
    expect(calls(fetch).filter((call) => call.startsWith("PUT"))).toEqual([]);
  });
});

describe("App notices tied to the session", () => {
  const data = (type: string, extra: Record<string, unknown> = {}, id = 1) => ({ notificationId: itineraryId(900 + id), type, tripId, ...extra });
  const fakePort = () => {
    let handlers: NativePushHandlers = {};
    const listen = vi.fn<PushRegistrationPort["listen"]>(async (value) => { handlers = value; return ok(async () => ok(undefined)); });
    const emit = (kind: "onAction" | "onNotification", values: Record<string, unknown>) => act(async () => { handlers[kind]?.({ id: "native", data: values } as NativePushNotification); });
    return { port: { listen }, action: (values: Record<string, unknown>) => emit("onAction", values), foreground: (values: Record<string, unknown>) => emit("onNotification", values) };
  };
  const trips = { trips: { list: vi.fn().mockResolvedValue({ ok: true, value: [] }) } as never };
  const type = async (name: string, value: string) => {
    const element = document.querySelector(`[name=${name}]`) as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  const submitLogin = async (email: string) => {
    await type("email", email); await type("password", "secret-pass");
    await act(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  };
  const announced = () => document.body.textContent?.includes("Tenés un aviso nuevo");

  it("a foreground announcement disappears on logout and is not shown at the login nor to the next account", async () => {
    const t = fakePort();
    await render("/trips", makeFetch(), { noticePort: t.port, ...trips });
    await t.foreground(data("post.created", { postId }));
    expect(announced()).toBe(true);
    await click(find("button", "Cerrar sesión"));
    expect(pathOf()).toBe("/login");
    expect(announced()).toBe(false);
    await submitLogin("b@example.test");
    expect(pathOf()).toBe("/trips");
    expect(announced()).toBe(false);
  });

  it("a foreground announcement disappears when the session expires (401)", async () => {
    const t = fakePort();
    let tripsStatus = 500;
    const base = makeFetch();
    const fetch = vi.fn().mockImplementation(async (url: string, request: RequestInit) =>
      new URL(url).pathname === "/trips" ? (tripsStatus === 500 ? json({ error: { code: "Server", message: "x" } }, 500) : denied(401)) : base(url, request));
    await render("/trips", fetch, { noticePort: t.port });
    await t.foreground(data("post.created", { postId }));
    expect(announced()).toBe(true);
    tripsStatus = 401;
    await click(find("button", "Reintentar"));
    expect(pathOf()).toBe("/login");
    expect(announced()).toBe(false);
  });

  it("an action pending when the session is rejected (401) is dropped: another account does not open it", async () => {
    const t = fakePort();
    let refreshes = 0;
    let release!: () => void;
    const base = makeFetch();
    const fetch = vi.fn().mockImplementation(async (url: string, request: RequestInit) => {
      if (new URL(url).pathname === "/auth/refresh") {
        refreshes += 1;
        await new Promise<void>((resolve) => { release = resolve; });
        return denied(401);
      }
      return base(url, request);
    });
    await render("/", fetch, { noticePort: t.port });
    await t.action(data("activity.created", { activityId }));
    await act(async () => release());
    expect(refreshes).toBe(1);
    // Dropped, not queued: nothing sends the user to the login by itself any more.
    expect(pathOf()).toBe("/");
    await click(find("a", "Iniciar sesión"));
    await submitLogin("b@example.test");
    expect(pathOf()).toBe("/trips");
  });
});

describe("App opening notices from a push", () => {
  const data = (type: string, extra: Record<string, unknown> = {}, id = 1) => ({ notificationId: itineraryId(900 + id), type, tripId, ...extra });
  const fakePort = () => {
    let handlers: NativePushHandlers = {};
    const stop = vi.fn(async () => ok(undefined));
    const listen = vi.fn<PushRegistrationPort["listen"]>(async (value) => { handlers = value; return ok(stop); });
    const emit = (kind: "onAction" | "onNotification", values: Record<string, unknown>) => act(async () => { handlers[kind]?.({ id: "native", data: values } as NativePushNotification); });
    return { port: { listen }, listen, stop, action: (values: Record<string, unknown>) => emit("onAction", values), foreground: (values: Record<string, unknown>) => emit("onNotification", values) };
  };

  it("is inert on the web: no push plugin is touched and the center still works", async () => {
    const container = await render("/notifications", makeFetch({ notifications: [postNotice()] }));
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(native.push.addListener).not.toHaveBeenCalled();
    expect(native.push.checkPermissions).not.toHaveBeenCalled();
    expect(native.push.requestPermissions).not.toHaveBeenCalled();
  });

  it("starts listening early, closes the listener on unmount and tolerates an unsupported port", async () => {
    const { port, listen, stop } = fakePort();
    await render("/trips", makeFetch(), { noticePort: port });
    expect(listen).toHaveBeenCalledTimes(1);
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    expect(stop).toHaveBeenCalledTimes(1);
    const unsupported = { listen: vi.fn(async () => err(new NativeCapabilityError("unsupported"))) };
    const container = await render("/notifications", makeFetch({ notifications: [postNotice()] }), { noticePort: unsupported });
    expect(container.querySelectorAll("li")).toHaveLength(1);
  });

  it("an action in the background opens the exact activity with the center as origin", async () => {
    const t = fakePort();
    await render("/trips", makeFetch(), { noticePort: t.port, trips: { list: vi.fn().mockResolvedValue({ ok: true, value: [] }) } as never });
    await t.action(data("activity.updated", { activityId }));
    expect(pathOf()).toBe(`/trips/${tripId}/itinerary?activity=${activityId}`);
    await click(find("a", "Volver a avisos"));
    expect(pathOf()).toBe("/notifications");
  });

  it("an action that is malformed is dropped without navigating", async () => {
    const t = fakePort();
    await render("/trips", makeFetch(), { noticePort: t.port, trips: { list: vi.fn().mockResolvedValue({ ok: true, value: [] }) } as never });
    await t.action(data("post.created", { postId: "../etc" }));
    await t.action({ type: "post.created", tripId, postId });
    expect(pathOf()).toBe("/trips");
  });

  it("an expulsion opens the center, never the Trip", async () => {
    const t = fakePort();
    const expelled = notice(1, "member.expelled", { tripId }, { actorId: null });
    const fetch = makeFetch({ notifications: [expelled] });
    await render("/trips", fetch, { noticePort: t.port, trips: { list: vi.fn().mockResolvedValue({ ok: true, value: [] }) } as never });
    await t.action(data("member.expelled"));
    expect(pathOf()).toBe("/notifications");
    expect(document.body.textContent).toContain("Ya no sos parte de este viaje");
    expect(calls(fetch).some((call) => call.includes(`/trips/${tripId}`))).toBe(false);
  });

  it("in the foreground it does not navigate: it announces once and «Ver avisos» opens the center", async () => {
    const t = fakePort();
    await render("/trips", makeFetch({ notifications: [postNotice()] }), { noticePort: t.port, trips: { list: vi.fn().mockResolvedValue({ ok: true, value: [] }) } as never });
    await t.foreground(data("post.created", { postId }));
    expect(pathOf()).toBe("/trips");
    const statuses = [...document.querySelectorAll('[role="status"]')].filter((element) => element.textContent?.includes("Tenés un aviso nuevo"));
    expect(statuses).toHaveLength(1);
    expect(statuses[0]!.textContent).not.toContain("Atardecer");
    await click(find("a", "Ver avisos"));
    expect(pathOf()).toBe("/notifications");
    expect(document.body.textContent).not.toContain("Tenés un aviso nuevo");
  });

  it("in the foreground with the center open it refreshes the list without announcing", async () => {
    const t = fakePort();
    const fetch = makeFetch({ notifications: [postNotice()] });
    await render("/notifications", fetch, { noticePort: t.port });
    await t.foreground(data("post.created", { postId }));
    expect(calls(fetch).filter((call) => call.endsWith("/notifications"))).toHaveLength(2);
    expect(document.body.textContent).not.toContain("Tenés un aviso nuevo");
  });

  it("an action at launch waits for the restored session and is not overridden by the launch redirect", async () => {
    const t = fakePort();
    let release!: () => void;
    const fetch = vi.fn().mockImplementation(async (url: string, request: RequestInit) => {
      if (new URL(url).pathname === "/auth/refresh") { await new Promise<void>((resolve) => { release = resolve; }); return json({ accessToken: "renewed", refreshToken: "refresh" }); }
      return makeFetch()(url, request);
    });
    await render("/", fetch, { noticePort: t.port });
    await t.action(data("activity.created", { activityId }));
    expect(pathOf()).toBe("/");
    await act(async () => release());
    expect(pathOf()).toBe(`/trips/${tripId}/itinerary?activity=${activityId}`);
  });

  it("without a session it goes to the login and resumes the destination once after authenticating", async () => {
    const t = fakePort();
    const fetch = makeFetch();
    await render("/", fetch, { noticePort: t.port }, false);
    await t.action(data("activity.created", { activityId }));
    expect(pathOf()).toBe("/login");
    const type = async (name: string, value: string) => {
      const element = document.querySelector(`[name=${name}]`) as HTMLInputElement;
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
    };
    await type("email", "nico@example.test"); await type("password", "secret-pass");
    await act(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(pathOf()).toBe(`/trips/${tripId}/itinerary?activity=${activityId}`);
  });

  it("the same notice delivered twice while signed out is kept once", async () => {
    const t = fakePort();
    await render("/", makeFetch(), { noticePort: t.port }, false);
    await t.action(data("activity.created", { activityId }));
    expect(pathOf()).toBe("/login");
    await t.action(data("activity.created", { activityId }));
    expect(pathOf()).toBe("/login");
  });
});
