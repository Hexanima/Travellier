// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.js";
import type { AppBackButton } from "./native/app-back-button.js";
import type { NativeAppUrlApi } from "./navigation/app-url-listener.js";
import { itineraryFixture, itineraryId } from "./trips/itinerary-test-fixture.js";
import { noticesOrigin } from "./trips/post-origin.js";
import { resetRememberedFilter } from "./trips/trips-filter-memory.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); vi.unstubAllGlobals(); resetRememberedFilter(); });

const tripId = itineraryId(1);
const me = itineraryId(20);
const backButton = () => {
  const listeners = new Set<() => void>();
  const exitApp = vi.fn();
  const port: AppBackButton = { onBack: (listener) => { listeners.add(listener); return () => listeners.delete(listener); }, exitApp };
  return { port, exitApp, press: async () => { await act(async () => listeners.forEach((listener) => listener())); } };
};
/** Arranque en frío con deep link: el WebView nativo siempre arranca en `/` y la URL llega por `getLaunchUrl`. */
const launcher = (url: string): NativeAppUrlApi => ({
  addListener: vi.fn().mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) }),
  getLaunchUrl: vi.fn().mockResolvedValue({ url }),
});
/** El provider mantiene el candado del Atrás unos 250 ms: dos pulsaciones del usuario van separadas por más que eso. */
const afterBackLock = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); }); };
const storage = () => ({ read: vi.fn().mockResolvedValue({ accessToken: "old", refreshToken: "refresh" }), save: vi.fn().mockResolvedValue(undefined), clear: vi.fn().mockResolvedValue(undefined) });
const auth = { refresh: vi.fn().mockResolvedValue({ ok: true, value: { accessToken: "access", refreshToken: "refresh" } }) };
const props = (over: Partial<ComponentProps<typeof App>> = {}): ComponentProps<typeof App> => ({
  auth, sessionStorage: storage(),
  trips: { list: vi.fn().mockResolvedValue({ ok: true, value: [] }), get: vi.fn().mockResolvedValue({ ok: true, value: { id: tripId, name: "Córdoba", description: null, expenseMode: "register" } }) },
  members: { list: vi.fn().mockResolvedValue({ ok: true, value: { currentUserId: me, members: [] } }) },
  itinerary: { get: vi.fn().mockResolvedValue({ ok: true, value: itineraryFixture() }) },
  participations: { get: vi.fn().mockResolvedValue({ ok: true, value: null }) },
  posts: { list: vi.fn().mockResolvedValue({ ok: true, value: [] }) },
  ...over,
});
/** El encabezado de la pantalla montada: afirma sobre la pantalla en sí y no sobre un texto que otra pantalla también muestra (su enlace, por ejemplo). */
const heading = (container: HTMLElement) => container.querySelector("h1")?.textContent;
type Entry = string | { pathname: string; search?: string; state?: unknown };
async function render(entry: Entry | Entry[], app: ComponentProps<typeof App>) {
  const entries = Array.isArray(entry) ? entry : [entry];
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}><App {...app} /></MemoryRouter>));
  return container;
}

describe("App back button integration", () => {
  it("desde una raíz del Trip vuelve a Mis viajes", async () => {
    const button = backButton();
    const container = await render(`/trips/${tripId}/itinerary`, props({ backButton: button.port }));
    expect(container.textContent).toContain("Itinerario");
    await button.press();
    expect(container.textContent).toContain("Mis viajes");
    expect(button.exitApp).not.toHaveBeenCalled();
  });

  it("desde una raíz del Trip la vuelta a Mis viajes no deja una pulsación de más antes de cerrar", async () => {
    const button = backButton();
    const container = await render(`/trips/${tripId}/itinerary`, props({ backButton: button.port }));
    await button.press();
    expect(container.textContent).toContain("Mis viajes");
    await afterBackLock();
    await button.press();
    expect(button.exitApp).toHaveBeenCalledTimes(1);
  });

  it("desde una raíz del Trip abierta desde Mis viajes, una pulsación vuelve y la siguiente cierra la app", async () => {
    const button = backButton();
    const container = await render(["/trips", `/trips/${tripId}/itinerary`], props({ backButton: button.port }));
    expect(container.textContent).toContain("Itinerario");
    await button.press();
    expect(heading(container)).toBe("Mis viajes");
    expect(button.exitApp).not.toHaveBeenCalled();
    await afterBackLock();
    await button.press();
    expect(button.exitApp).toHaveBeenCalledTimes(1);
  });

  it("el recorrido desde una raíz del Trip abierta por un aviso conserva el historial de Avisos hasta la salida", async () => {
    const button = backButton();
    const notifications = { list: vi.fn().mockResolvedValue({ ok: true, value: { notifications: [], unreadCount: 0 } }) };
    const container = await render(["/trips", "/notifications", { pathname: `/trips/${tripId}/itinerary`, state: { origin: noticesOrigin } }],
      props({ backButton: button.port, notifications }));
    await button.press();
    expect(heading(container)).toBe("Avisos");
    await afterBackLock();
    // Avisos conserva su propio origen: la pulsación siguiente sigue su historial (acá, la entrada de Avisos que abrió el viaje) en vez de caer en Mis viajes.
    await button.press();
    expect(heading(container)).toBe("Avisos");
    await afterBackLock();
    await button.press();
    expect(heading(container)).toBe("Mis viajes");
    expect(button.exitApp).not.toHaveBeenCalled();
    await afterBackLock();
    await button.press();
    expect(button.exitApp).toHaveBeenCalledTimes(1);
  });

  it("abierto un aviso de una raíz del Trip desde el perfil, el Atrás llega a Avisos y vuelve al perfil sin cerrar la app", async () => {
    const button = backButton();
    const notifications = { list: vi.fn().mockResolvedValue({ ok: true, value: { notifications: [], unreadCount: 0 } }) };
    const container = await render(["/profile", "/notifications", { pathname: `/trips/${tripId}/itinerary`, state: { origin: noticesOrigin } }],
      props({ backButton: button.port, notifications }));
    await button.press();
    expect(heading(container)).toBe("Avisos");
    await afterBackLock();
    // Avisos conserva su historial: la pulsación siguiente lo sigue hacia atrás. Repite Avisos porque la entrada de la raíz del Trip se
    // reemplazó por Avisos justo encima de la entrada de Avisos que abrió el viaje; lo que importa es que el perfil siga alcanzable.
    await button.press();
    expect(heading(container)).toBe("Avisos");
    await afterBackLock();
    await button.press();
    expect(heading(container)).toBe("Mi perfil");
    expect(button.exitApp).not.toHaveBeenCalled();
  });

  it("en Mis viajes abierto desde otra pantalla el Atrás vuelve a ella en vez de cerrar", async () => {
    const button = backButton();
    const notifications = { list: vi.fn().mockResolvedValue({ ok: true, value: { notifications: [], unreadCount: 0 } }) };
    const container = await render(["/notifications", "/trips"], props({ backButton: button.port, notifications }));
    expect(heading(container)).toBe("Mis viajes");
    await button.press();
    expect(heading(container)).toBe("Avisos");
    expect(button.exitApp).not.toHaveBeenCalled();
  });

  it("desde una raíz del Trip abierta por un aviso vuelve a avisos, igual que su enlace Volver", async () => {
    const button = backButton();
    const notifications = { list: vi.fn().mockResolvedValue({ ok: true, value: { notifications: [], unreadCount: 0 } }) };
    const container = await render({ pathname: `/trips/${tripId}/itinerary`, state: { origin: noticesOrigin } }, props({ backButton: button.port, notifications }));
    expect(container.querySelector("a.trips-back")?.textContent).toBe("Volver a avisos");
    await button.press();
    expect(heading(container)).toBe("Avisos");
  });

  it("en Mis viajes sin historial cierra la app en vez de dejar el Atrás muerto", async () => {
    const button = backButton();
    await render("/trips", props({ backButton: button.port }));
    await button.press();
    expect(button.exitApp).toHaveBeenCalledTimes(1);
  });

  it("en una pantalla interna sin historial vuelve a Mis viajes", async () => {
    const button = backButton();
    const container = await render(`/trips/${tripId}/journey`, props({ backButton: button.port, journey: { listDestinations: vi.fn().mockResolvedValue({ ok: true, value: [] }) } }));
    await button.press();
    expect(container.textContent).toContain("Mis viajes");
    expect(button.exitApp).not.toHaveBeenCalled();
  });

  it("en una pantalla interna con historial vuelve a la anterior", async () => {
    const button = backButton();
    const notifications = { list: vi.fn().mockResolvedValue({ ok: true, value: { notifications: [], unreadCount: 0 } }) };
    const container = await render(["/trips", "/notifications"], props({ backButton: button.port, notifications }));
    expect(heading(container)).toBe("Avisos");
    await button.press();
    expect(heading(container)).toBe("Mis viajes");
  });

  it("sin puerto nativo no se toca nada: la app sigue funcionando con el Atrás del navegador", async () => {
    const container = await render(`/trips/${tripId}/itinerary`, props());
    expect(container.textContent).toContain("Itinerario");
  });

  it("con el detalle de una actividad abierto, el Atrás lo cierra y deja el itinerario igual", async () => {
    const button = backButton();
    const activityId = itineraryId(8);
    const activities = { get: vi.fn().mockResolvedValue({ ok: true, value: itineraryFixture().activities.find((activity) => activity.id === activityId) }) };
    const container = await render({ pathname: `/trips/${tripId}/itinerary`, search: `?activity=${activityId}&day=2026-09-25` }, props({ backButton: button.port, activities }));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await button.press();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain("Itinerario");
  });

  it("con el detalle abierto desde el itinerario (entrada propia) el Atrás vuelve al itinerario tal cual estaba", async () => {
    const button = backButton();
    const activityId = itineraryId(8);
    const activities = { get: vi.fn().mockResolvedValue({ ok: true, value: itineraryFixture().activities.find((activity) => activity.id === activityId) }) };
    const container = await render(`/trips/${tripId}/itinerary`, props({ backButton: button.port, activities }));
    const open = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes("Paseo por el centro"));
    await act(async () => open?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await button.press();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain("Itinerario");
    expect(button.exitApp).not.toHaveBeenCalled();
  });

  it("con el selector de destinos abierto el Atrás lo cierra sin cambiar el día", async () => {
    const button = backButton();
    const container = await render({ pathname: `/trips/${tripId}/itinerary`, search: "?day=2026-09-25" }, props({ backButton: button.port }));
    const banner = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes("Ver destinos"));
    await act(async () => banner?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("Destinos del viaje");
    await button.press();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector("[aria-current=date]")?.getAttribute("data-day")).toBe("2026-09-25");
  });

  it("con el compositor de recuerdos sucio el Atrás pide confirmación y Descartar sale", async () => {
    const button = backButton();
    const container = await render([`/trips/${tripId}/memories`, `/trips/${tripId}/memories/new`], props({ backButton: button.port }));
    const description = container.querySelector("[name=description]") as HTMLTextAreaElement;
    expect(description).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(description, "Un recuerdo");
      description.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await button.press();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Descartar cambios");
    expect(container.querySelector("[name=description]")).not.toBeNull();
    const discard = Array.from(document.querySelectorAll("button")).find((item) => item.textContent === "Descartar");
    await act(async () => discard?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
    expect(container.querySelector("[name=description]")).toBeNull();
  });

  it("sin sesión sobre la entrada inicial, el Atrás cierra la app en vez de quedar muerto", async () => {
    const button = backButton();
    const noSession = { read: vi.fn().mockResolvedValue(null), save: vi.fn().mockResolvedValue(undefined), clear: vi.fn().mockResolvedValue(undefined) };
    const container = await render(`/trips/${tripId}/memories`, props({ backButton: button.port, sessionStorage: noSession }));
    expect(container.textContent).toContain("Iniciar sesión");
    await button.press();
    expect(button.exitApp).toHaveBeenCalledTimes(1);
  });

  it("sin sesión con historial detrás, el Atrás vuelve y recién la pulsación siguiente cierra", async () => {
    const button = backButton();
    const noSession = { read: vi.fn().mockResolvedValue(null), save: vi.fn().mockResolvedValue(undefined), clear: vi.fn().mockResolvedValue(undefined) };
    await render(["/trips", `/trips/${tripId}/memories`], props({ backButton: button.port, sessionStorage: noSession }));
    await button.press();
    expect(button.exitApp).not.toHaveBeenCalled();
    await afterBackLock();
    await button.press();
    expect(button.exitApp).toHaveBeenCalledTimes(1);
  });

  it("un enlace sin pantalla propia con historial detrás no cierra la app", async () => {
    const button = backButton();
    const container = await render(["/trips", "/verify"], props({ backButton: button.port }));
    expect(container.textContent).toContain("Mis viajes");
    await button.press();
    expect(button.exitApp).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Mis viajes");
  });

  it("después de iniciar sesión con historial detrás el Atrás vuelve en vez de cerrar", async () => {
    const button = backButton();
    const noSession = { read: vi.fn().mockResolvedValue(null), save: vi.fn().mockResolvedValue(undefined), clear: vi.fn().mockResolvedValue(undefined) };
    const login = vi.fn().mockResolvedValue({ ok: true, value: { accessToken: "access", refreshToken: "refresh" } });
    const container = await render(["/trips", "/login"], props({ backButton: button.port, sessionStorage: noSession, auth: { ...auth, login } }));
    const email = container.querySelector("input[name=email]") as HTMLInputElement;
    const password = container.querySelector("input[name=password]") as HTMLInputElement;
    await act(async () => {
      email.value = "viajera@test.com"; email.dispatchEvent(new Event("input", { bubbles: true }));
      password.value = "secreta"; password.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(login).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Mis viajes");
    await button.press();
    expect(button.exitApp).not.toHaveBeenCalled();
  });

  it("al cerrar sesión el primer Atrás hace algo visible en vez de quedar muerto", async () => {
    const button = backButton();
    const container = await render("/trips", props({ backButton: button.port }));
    const logout = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Cerrar sesión");
    expect(logout).toBeTruthy();
    await act(async () => logout!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
    expect(container.textContent).toContain("Iniciar sesión");
    await button.press();
    expect(button.exitApp).toHaveBeenCalledTimes(1);
  });

  it("en las fotos, el Atrás cierra el visor y deja la galería donde estaba", async () => {
    const button = backButton();
    const photo = { id: itineraryId(40), postId: itineraryId(540), order: 0, uploadedAt: "2026-09-26T10:00:00.000Z", uploaderId: me,
      url: "https://s3.test/40?sig=x", expiresAtMs: Date.parse("2100-01-01T00:00:00.000Z"),
      post: { createdAt: "2026-09-26T09:00:00.000Z", authorId: me, rootActivityId: null, rootTransportId: null } };
    const gallery = { list: vi.fn().mockResolvedValue({ ok: true, value: { photos: [photo], nextCursor: null } }) };
    const container = await render(`/trips/${tripId}/memories/photos`, props({ backButton: button.port, gallery }));
    await act(async () => container.querySelector(`[data-photo="${photo.id}"] button`)?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await button.press();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector(`[data-photo="${photo.id}"]`)).not.toBeNull();
  });

  it("tras un arranque en frío con deep link, el Atrás no cae en la pantalla pública", async () => {
    const button = backButton();
    const nativeApp = launcher("com.travellier.app://invite/VIAJE-X7K2");
    const container = await render("/", props({ backButton: button.port, nativeApp }));
    expect(container.textContent).toContain("Confirmar unión");
    await button.press();
    expect(container.textContent).not.toContain("El viaje empieza con ustedes.");
    expect(container.textContent).toContain("Mis viajes");
  });

  it("al salir del viaje desde la entrada inicial, el Atrás no queda muerto sobre Mis viajes", async () => {
    const button = backButton();
    const leave = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    const members = {
      list: vi.fn().mockResolvedValue({ ok: true, value: { currentUserId: "ana", ownerId: "owner", members: [
        { id: "m1", userId: "owner", name: "Nico", role: "admin", isOwner: true, joinedAt: "2026-09-24T12:00:00.000Z" },
        { id: "m2", userId: "ana", name: "Ana", role: "participant", isOwner: false, joinedAt: "2026-09-24T12:00:00.000Z" },
      ] } }),
      leave,
    };
    const trips = {
      list: vi.fn().mockResolvedValue({ ok: true, value: [] }),
      get: vi.fn().mockResolvedValue({ ok: true, value: { kind: "member", id: tripId, name: "Córdoba", description: null, primaryDestination: { name: "Córdoba" }, visibility: "private", expenseMode: "register" } }),
    };
    const container = await render(`/trips/${tripId}/members`, props({ backButton: button.port, members, trips }));
    const press = (label: string) => act(async () => Array.from(container.querySelectorAll("button")).find((item) => item.textContent === label)?.click());
    await press("Salir del viaje");
    await press("Confirmar salida");
    expect(leave).toHaveBeenCalledWith(tripId);
    expect(container.textContent).toContain("Mis viajes");
    await button.press();
    expect(button.exitApp).toHaveBeenCalledTimes(1);
  });
  it("en Mis viajes como entrada inicial, cambiar de pestaña no deja el Atrás muerto", async () => {
    const button = backButton();
    const container = await render("/trips", props({ backButton: button.port }));
    const finished = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((item) => item.textContent === "Finalizados");
    await act(async () => finished?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
    expect(finished?.getAttribute("aria-selected")).toBe("true");
    await button.press();
    expect(button.exitApp).toHaveBeenCalledTimes(1);
  });

  it("al borrar un recuerdo abierto desde otro recuerdo sin historial, el Atrás siguiente no queda muerto", async () => {
    const button = backButton();
    const parentId = itineraryId(30), postId = itineraryId(31);
    const path = (id: string) => `/trips/${tripId}/memories/${id}`;
    const post = (id: string) => ({ id, tripId, authorId: me, description: `Recuerdo ${id}`, mapsUrl: null, activityId: null, parentPostId: null, transportId: null,
      createdAt: "2026-09-26T09:00:00.000Z" });
    const posts = {
      list: vi.fn().mockResolvedValue({ ok: true, value: [] }),
      get: vi.fn().mockImplementation(async (_trip: string, id: string) => ({ ok: true, value: { post: post(id), parent: null, children: [], rootActivityId: null } })),
      remove: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    };
    const members = { list: vi.fn().mockResolvedValue({ ok: true, value: { currentUserId: me, members: [{ userId: me, name: "Ana", role: "participant" }] } }) };
    const comments = { list: vi.fn().mockResolvedValue({ ok: true, value: [] }), create: vi.fn(), update: vi.fn(), remove: vi.fn() };
    const likes = { summary: vi.fn().mockResolvedValue({ ok: true, value: { post: { count: 0, likedByMe: false }, comments: {} } }), setPostLike: vi.fn(), setCommentLike: vi.fn() };
    const container = await render({ pathname: path(postId), state: { origin: { path: path(parentId), label: "recuerdo" } } },
      props({ backButton: button.port, posts, members, comments, likes }));
    const press = (label: string) => act(async () => Array.from(document.querySelectorAll("button")).find((item) => item.textContent === label)?.click());
    await press("Eliminar recuerdo");
    await press("Eliminar");
    expect(posts.remove).toHaveBeenCalledWith(tripId, postId);
    expect(container.textContent).toContain(`Recuerdo ${parentId}`);
    await button.press();
    expect(container.textContent).toContain("Mis viajes");
  });
});
