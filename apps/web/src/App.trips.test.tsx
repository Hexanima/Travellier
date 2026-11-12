// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App.js";
import type { NativeAppUrlApi } from "./navigation/app-url-listener.js";
import type { NativeSessionStorage } from "./auth/native-session-storage.js";
import { getRememberedFilter, resetRememberedFilter } from "./trips/trips-filter-memory.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  resetRememberedFilter();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
});

const storage = (session: boolean): NativeSessionStorage => ({
  read: vi.fn().mockResolvedValue(session ? { accessToken: "access", refreshToken: "refresh" } : null),
  save: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
});

const tripId = "507f191e810c19729de860ea";
const memberTrip = {
  kind: "member", id: tripId, name: "Patagonia", description: null,
  primaryDestination: { name: "Bariloche" }, visibility: "private",
  expenseMode: "register",
};

async function render(path: string, session: boolean, trips: Record<string, unknown>, journey?: Record<string, unknown>, members?: Record<string, unknown>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(
    <MemoryRouter initialEntries={[path]}>
      <App
        auth={{ refresh: vi.fn().mockResolvedValue({ ok: true, value: { accessToken: "new", refreshToken: "new-refresh" } }) }}
        sessionStorage={storage(session)}
        trips={trips as never}
        journey={journey as never}
        members={members as never}
      />
    </MemoryRouter>,
  ));
  return container;
}

describe("App Trip routes", () => {
  it("edits visibility and expenses without offering a retired voting setting, even for a legacy Trip", async () => {
    const legacy = await render(`/trips/${tripId}/config`, true, { get: async () => ({ ok: true, value: { ...memberTrip, votingEnabled: true } }) });
    expect(legacy.querySelector('[name="votingEnabled"]')).toBeNull();
    expect(legacy.querySelector('[name="visibility"]')).not.toBeNull();
    const active = { ...memberTrip };
    const updateConfiguration = vi.fn().mockResolvedValue({ ok: true, value: active });
    const container = await render(`/trips/${tripId}/config`, true, { get: async () => ({ ok: true, value: active }), updateConfiguration });
    expect(container.querySelector('[name="visibility"]')).not.toBeNull();
    expect(container.querySelector('[name="expenseMode"]')).not.toBeNull();
    expect(container.querySelector('[name="votingEnabled"]')).toBeNull();
    await act(async () => container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(updateConfiguration).toHaveBeenCalledWith(tripId, { visibility: "private", expenseMode: "register" });
    expect(container.textContent).toContain("Configuración guardada");
  });
  it("connects admin group deletion and reloads My Trips", async () => {
    const deleteTrip = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    const list = vi.fn().mockResolvedValue({ ok: true, value: [] });
    const container = await render(`/trips/${tripId}/members`, true, {
      get: async () => ({ ok: true, value: memberTrip }), deleteTrip, list,
    }, undefined, {
      list: async () => ({ ok: true, value: { currentUserId: "admin", ownerId: "admin", members: [
        { id: "membership", userId: "admin", name: "Admin", role: "admin", isOwner: true, joinedAt: new Date().toISOString() },
      ] } }),
    });
    await act(async () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Eliminar viaje")?.click());
    await act(async () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Eliminar definitivamente")?.click());
    expect(deleteTrip).toHaveBeenCalledWith(tripId);
    expect(list).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Mis viajes");
  });
  it("connects leaving the Trip: calls the API, reloads My Trips and keeps no Trip data", async () => {
    const leave = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    const list = vi.fn().mockResolvedValue({ ok: true, value: [] });
    const container = await render(`/trips/${tripId}/members`, true, {
      get: async () => ({ ok: true, value: { ...memberTrip, inviteCode: "VIAJE-X7K2" } }), list,
    }, undefined, {
      list: async () => ({ ok: true, value: { currentUserId: "ana", ownerId: "owner", members: [
        { id: "m1", userId: "owner", name: "Nico", role: "admin", isOwner: true, joinedAt: new Date().toISOString() },
        { id: "m2", userId: "ana", name: "Ana", role: "participant", isOwner: false, joinedAt: new Date().toISOString() },
      ] } }), leave,
    });
    const press = (label: string) => act(async () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === label)?.click());
    await press("Salir del viaje");
    await press("Confirmar salida");
    expect(leave).toHaveBeenCalledWith(tripId);
    expect(list).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Mis viajes");
    expect(container.textContent).not.toContain("Patagonia");
  });
  it("connects destination deletion from the protected journey route", async () => {
    const first = { id: "507f191e810c19729de860e1", tripId, name: "Bariloche", order: 1, createdAt: new Date().toISOString(), hasRecords: false };
    const second = { ...first, id: "507f191e810c19729de860e2", name: "Córdoba", order: 2 };
    const deleteDestination = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    const container = await render(`/trips/${tripId}/journey`, true, {
      get: async () => ({ ok: true, value: memberTrip }),
    }, {
      listDestinations: vi.fn().mockResolvedValueOnce({ ok: true, value: [first, second] })
        .mockResolvedValue({ ok: true, value: [first] }),
      listTransports: async () => ({ ok: true, value: [] }), deleteDestination,
    });
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Eliminar destino Córdoba"]')?.click());
    await act(async () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Confirmar eliminación")?.click());
    expect(deleteDestination).toHaveBeenCalledWith(tripId, second.id);
    expect(container.querySelectorAll(".journey-destination")).toHaveLength(1);
  });
  const publicTrip = {
    kind: "public", id: tripId, name: "Patagonia", description: "Lagos y senderos",
    primaryDestination: { name: "Bariloche" }, visibility: "public",
  };

  it("guards the journey route before login", async () => {
    const get = vi.fn();
    const container = await render(`/trips/${tripId}/journey`, false, { get });
    expect(container.textContent).toContain("Iniciar sesión");
    expect(get).not.toHaveBeenCalled();
  });

  it("guards public discovery before login", async () => {
    const listPublic = vi.fn();
    const container = await render("/trips/explore", false, { listPublic });

    expect(container.textContent).toContain("Iniciar sesión");
    expect(listPublic).not.toHaveBeenCalled();
  });

  it("guards the confirmation route before login", async () => {
    const get = vi.fn();
    const joinPublic = vi.fn();
    const container = await render(`/trips/explore/${tripId}`, false, { get, joinPublic });

    expect(container.textContent).toContain("Iniciar sesión");
    expect(get).not.toHaveBeenCalled();
    expect(joinPublic).not.toHaveBeenCalled();
  });

  it("shows only public Trips and their decision fields in discovery", async () => {
    const listPublic = vi.fn().mockResolvedValue({ ok: true, value: [
      publicTrip,
      { ...publicTrip, id: "507f191e810c19729de860eb", name: "Privado", visibility: "private" },
    ] });
    const container = await render("/trips/explore", true, { listPublic });

    expect(listPublic).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Patagonia");
    expect(container.textContent).toContain("Bariloche");
    expect(container.textContent).toContain("Lagos y senderos");
    expect(container.textContent).not.toContain("Privado");
    expect(container.querySelector(`a[href="/trips/explore/${tripId}"]`)).not.toBeNull();
  });

  it("offers discovery from an empty Trip list", async () => {
    const list = vi.fn().mockResolvedValue({ ok: true, value: [] });
    const container = await render("/trips", true, { list });

    expect(container.querySelector('a[href="/trips/explore"]')).not.toBeNull();
  });

  it("retries a failed discovery request and shows the empty state", async () => {
    const listPublic = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { kind: "network" } })
      .mockResolvedValueOnce({ ok: true, value: [] });
    const container = await render("/trips/explore", true, { listPublic });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("No pudimos cargar");
    await act(async () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Reintentar")?.click());
    expect(listPublic).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("No hay viajes públicos");
    expect(container.querySelector('a[href="/trips/join"]')).not.toBeNull();
  });

  it("shows a public preview before joining, then reloads My Trips", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: publicTrip });
    const joinPublic = vi.fn().mockResolvedValue({ ok: true, value: { tripId, joined: true } });
    const list = vi.fn().mockResolvedValue({ ok: true, value: [publicTrip] });
    const container = await render(`/trips/explore/${tripId}`, true, { get, joinPublic, list });

    expect(get).toHaveBeenCalledWith(tripId);
    expect(container.textContent).toContain("Patagonia");
    expect(container.textContent).toContain("Bariloche");
    expect(container.textContent).toContain("Lagos y senderos");
    expect(joinPublic).not.toHaveBeenCalled();
    await act(async () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Confirmar unión")?.click());
    expect(joinPublic).toHaveBeenCalledWith(tripId);
    expect(list).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Mis viajes");
    expect(container.textContent).toContain("Patagonia");
  });

  it("does not show a private Trip in the confirmation screen", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: { ...memberTrip, name: "Viaje secreto" } });
    const joinPublic = vi.fn();
    const container = await render(`/trips/explore/${tripId}`, true, { get, joinPublic });

    expect(container.textContent).not.toContain("Viaje secreto");
    expect(container.textContent).toContain("no está disponible");
    expect(joinPublic).not.toHaveBeenCalled();
  });

  it("does not offer joining when the user is already a public Trip member", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: { ...memberTrip, visibility: "public" } });
    const joinPublic = vi.fn();
    const container = await render(`/trips/explore/${tripId}`, true, { get, joinPublic });

    expect(container.textContent).toContain("Ya sos parte");
    expect(container.querySelector('a[href="/trips"]')).not.toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(joinPublic).not.toHaveBeenCalled();
  });

  it("prevents a second public join while confirmation is pending", async () => {
    let resolveJoin: (result: unknown) => void = () => undefined;
    const get = vi.fn().mockResolvedValue({ ok: true, value: publicTrip });
    const joinPublic = vi.fn(() => new Promise((resolve) => { resolveJoin = resolve; }));
    const list = vi.fn().mockResolvedValue({ ok: true, value: [publicTrip] });
    const container = await render(`/trips/explore/${tripId}`, true, { get, joinPublic, list });

    await act(async () => { container.querySelector("button")?.click(); });
    expect(container.querySelector("button")).toHaveProperty("disabled", true);
    await act(async () => { container.querySelector("button")?.click(); });
    expect(joinPublic).toHaveBeenCalledOnce();
    await act(async () => resolveJoin({ ok: true, value: { tripId, joined: true } }));
    expect(container.textContent).toContain("Mis viajes");
  });

  it("handles a Trip made private after preview without showing it again", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: publicTrip });
    const joinPublic = vi.fn().mockResolvedValue({ ok: false, error: { kind: "not-found" } });
    const container = await render(`/trips/explore/${tripId}`, true, { get, joinPublic });

    await act(async () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Confirmar unión")?.click());
    expect(container.textContent).not.toContain("Patagonia");
    expect(container.textContent).toContain("no está disponible");
    expect(joinPublic).toHaveBeenCalledOnce();
  });
  it("lets a signed-in user enter a code and confirms joining before sending it", async () => {
    const joinByCode = vi.fn().mockResolvedValue({ ok: true, value: { tripId, joined: true } });
    const container = await render("/trips/join", true, { joinByCode });
    expect(container.textContent).toContain("Ingresar código");
    const input = container.querySelector('[name="code"]') as HTMLInputElement;
    await act(async () => container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(container.textContent).toContain("Ingresá un código");
    expect(joinByCode).not.toHaveBeenCalled();
    await act(async () => { input.value = " VIAJE-X7K2 "; });
    await act(async () => container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(container.textContent).toContain("Confirmar unión");
    expect(joinByCode).not.toHaveBeenCalled();
    await act(async () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Confirmar unión")?.click());
    expect(joinByCode).toHaveBeenCalledWith("VIAJE-X7K2");
    expect(container.textContent).toContain("Te uniste al viaje");
  });

  it("guards the manual code and member screens before login", async () => {
    const get = vi.fn();
    const listMembers = vi.fn();
    const join = await render("/trips/join", false, {});
    expect(join.textContent).toContain("Iniciar sesión");
    const members = await render(`/trips/${tripId}/members`, false, { get, listMembers });
    expect(members.textContent).toContain("Iniciar sesión");
    expect(get).not.toHaveBeenCalled();
    expect(listMembers).not.toHaveBeenCalled();
  });
  it("guards the Trip list without requesting private data before login", async () => {
    const list = vi.fn();
    const container = await render("/trips", false, { list });

    expect(container.textContent).toContain("Iniciar sesión");
    expect(container.textContent).not.toContain("Mis viajes");
    expect(list).not.toHaveBeenCalled();
  });

  it("loads the list after restoring a session", async () => {
    const list = vi.fn().mockResolvedValue({ ok: true, value: [] });
    const container = await render("/trips", true, { list });

    expect(list).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Mis viajes");
    expect(container.textContent).toContain("Todavía no tenés viajes");
  });

  it("opens the creation screen only for a signed-in user", async () => {
    const create = vi.fn();
    const publicView = await render("/trips/new", false, { create });
    expect(publicView.textContent).toContain("Iniciar sesión");
    expect(create).not.toHaveBeenCalled();

    const privateView = await render("/trips/new", true, { create });
    expect(privateView.textContent).toContain("Crear viaje");
    expect(privateView.querySelector('[name="primaryDestination"]')).not.toBeNull();
    expect(privateView.querySelector('input[type="date"]')).toBeNull();
  });

  it("does not request Trip configuration before login", async () => {
    const get = vi.fn();
    const container = await render(`/trips/${tripId}/config`, false, { get });

    expect(container.textContent).toContain("Iniciar sesión");
    expect(get).not.toHaveBeenCalled();
  });

  it("loads member settings and persists them after reopening the screen", async () => {
    let stored = { ...memberTrip };
    const get = vi.fn(async () => ({ ok: true, value: { ...stored } }));
    const updateConfiguration = vi.fn(async (_id: string, input: Record<string, unknown>) => {
      stored = { ...stored, ...input };
      return { ok: true, value: { ...stored } };
    });
    const trips = { get, updateConfiguration };
    const first = await render(`/trips/${tripId}/config`, true, trips);

    expect(first.querySelector('[name="visibility"]')).toHaveProperty("value", "private");
    expect(first.querySelector('[name="votingEnabled"]')).toBeNull();
    expect(first.querySelector('[name="expenseMode"]')).toHaveProperty("value", "register");
    await act(async () => {
      for (const [name, value] of [["visibility", "public"], ["expenseMode", "balance"]]) {
        const select = first.querySelector(`[name="${name}"]`) as HTMLSelectElement;
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await act(async () => first.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(updateConfiguration).toHaveBeenCalledWith(tripId, { visibility: "public", expenseMode: "balance" });
    expect(first.textContent).toContain("Configuración guardada");
    const second = await render(`/trips/${tripId}/config`, true, trips);
    expect(second.querySelector('[name="visibility"]')).toHaveProperty("value", "public");
    expect(second.querySelector('[name="votingEnabled"]')).toBeNull();
    expect(second.querySelector('[name="expenseMode"]')).toHaveProperty("value", "balance");
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("shows a public preview without editing controls", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: {
      kind: "public", id: tripId, name: "Patagonia", description: null,
      primaryDestination: { name: "Bariloche" }, visibility: "public",
    } });
    const updateConfiguration = vi.fn();
    const container = await render(`/trips/${tripId}/config`, true, { get, updateConfiguration });

    expect(container.textContent).toContain("Patagonia");
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector('[name="visibility"]')).toBeNull();
    expect(updateConfiguration).not.toHaveBeenCalled();
  });

  it("keeps edited settings after a failed save and offers retry", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: memberTrip });
    const updateConfiguration = vi.fn().mockResolvedValue({ ok: false, error: { kind: "network" } });
    const container = await render(`/trips/${tripId}/config`, true, { get, updateConfiguration });
    await act(async () => {
      const select = container.querySelector('[name="expenseMode"]') as HTMLSelectElement;
      select.value = "balance";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(container.querySelector('[name="expenseMode"]')).toHaveProperty("value", "balance");
    expect(container.textContent).toContain("No pudimos guardar");
    expect(updateConfiguration).toHaveBeenCalledOnce();
  });

  it("hides configuration controls if membership is lost before saving", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: memberTrip });
    const updateConfiguration = vi.fn().mockResolvedValue({ ok: false, error: { kind: "not-found" } });
    const container = await render(`/trips/${tripId}/config`, true, { get, updateConfiguration });
    await act(async () => container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("No encontramos este viaje");
  });

  it("explains the effect of changing the expense mode before saving", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: memberTrip });
    const container = await render(`/trips/${tripId}/config`, true, { get });
    await act(async () => {
      const expenses = container.querySelector('[name="expenseMode"]') as HTMLSelectElement;
      expenses.value = "balance";
      expenses.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container.textContent).not.toContain("actividades existentes");
    expect(container.textContent).toContain("gastos anteriores se conservan");
  });

  describe("Active/Finished list", () => {
    const dated = (id: string, name: string, endAt: string | null) =>
      ({ id, name, description: null, primaryDestination: { name: "Destino" }, startAt: null, endAt });
    const finishedTrip = dated(tripId, "Terminado", "2020-01-09T10:00:00.000Z");
    const activeTrip = dated("507f191e810c19729de860eb", "Futuro", "2099-01-09T10:00:00.000Z");
    const names = (container: HTMLElement) => [...container.querySelectorAll(".trips-item h2")].map((el) => el.textContent);
    const tabButton = (container: HTMLElement, label: string) => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((el) => el.textContent === label);
    const backLink = (container: HTMLElement) => [...container.querySelectorAll("a")].find((a) => a.textContent === "Volver a mis viajes");

    it("keeps Finalizados selected when coming back from a Trip with the back link", async () => {
      const list = vi.fn().mockResolvedValue({ ok: true, value: [finishedTrip, activeTrip] });
      const container = await render("/trips", true, { list, get: async () => ({ ok: true, value: memberTrip }) });
      expect(names(container)).toEqual(["Futuro"]);
      await act(async () => tabButton(container, "Finalizados")?.click());
      await act(async () => container.querySelector<HTMLElement>(`a[href="/trips/${tripId}/config"]`)?.click());
      expect(container.textContent).toContain("Configuración del viaje");
      await act(async () => backLink(container)?.click());
      expect(tabButton(container, "Finalizados")?.getAttribute("aria-selected")).toBe("true");
      expect(names(container)).toEqual(["Terminado"]);
    });

    it("forgets the selected tab when the session is closed", async () => {
      const list = vi.fn().mockResolvedValue({ ok: true, value: [finishedTrip, activeTrip] });
      const container = await render("/trips", true, { list });
      await act(async () => tabButton(container, "Finalizados")?.click());
      expect(getRememberedFilter()).toBe("finished");
      await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Cerrar sesión")?.click());
      expect(getRememberedFilter()).toBe("active");
    });

    describe("with the default HTTP client", () => {
      let unauthorizedProfile = false;
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      const fakeFetch = vi.fn(async (url: string, init: RequestInit) => {
        const path = new URL(url).pathname;
        const body = typeof init.body === "string" ? JSON.parse(init.body) as Record<string, string> : undefined;
        if (path === "/auth/refresh") return json({ accessToken: "access-A", refreshToken: "r-A" });
        if (path === "/auth/login") return json({ accessToken: "access-B", refreshToken: `r-${body?.email}` });
        if (path === "/trips") return json({ trips: [finishedTrip, activeTrip] });
        if (path === "/profile") return unauthorizedProfile ? json({ error: { code: "Unauthorized", message: "x" } }, 401) : json({ profile: { name: "Nico", email: "a@example.test", avatar: null } });
        return json({}, 404);
      });
      let navigateTo: (path: string) => void = () => undefined;
      function Navigator() { const navigate = useNavigate(); navigateTo = (path) => navigate(path); return null; }
      beforeEach(() => { unauthorizedProfile = false; vi.stubGlobal("fetch", fakeFetch); });
      afterEach(() => { vi.unstubAllGlobals(); });
      // The launch URL never resolves, so an authenticated session is not redirected away from /login.
      const nativeApp: NativeAppUrlApi = {
        addListener: vi.fn(async () => ({ remove: vi.fn().mockResolvedValue(undefined) })),
        getLaunchUrl: vi.fn(() => new Promise<undefined>(() => undefined)),
      };
      const renderApi = async () => {
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        roots.push(root);
        await act(async () => root.render(
          <MemoryRouter initialEntries={["/trips"]}><App apiBaseUrl="https://api.test" sessionStorage={storage(true)} nativeApp={nativeApp} /><Navigator /></MemoryRouter>,
        ));
        return container;
      };

      it("forgets the selected tab when a 401 ends the session", async () => {
        const container = await renderApi();
        await act(async () => tabButton(container, "Finalizados")?.click());
        expect(getRememberedFilter()).toBe("finished");
        unauthorizedProfile = true;
        await act(async () => container.querySelector<HTMLElement>('a[href="/profile"]')?.click());
        expect(container.textContent).toContain("Iniciar sesión");
        expect(getRememberedFilter()).toBe("active");
      });

      it("opens the list in Activos after another account signs in", async () => {
        const container = await renderApi();
        await act(async () => tabButton(container, "Finalizados")?.click());
        expect(getRememberedFilter()).toBe("finished");
        await act(async () => navigateTo("/login"));
        await act(async () => {
          (container.querySelector("[name=email]") as HTMLInputElement).value = "b@example.test";
          (container.querySelector("[name=password]") as HTMLInputElement).value = "secret-pass";
          container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        });
        expect(getRememberedFilter()).toBe("active");
        expect(tabButton(container, "Activos")?.getAttribute("aria-selected")).toBe("true");
        expect(names(container)).toEqual(["Futuro"]);
      });
    });

    it("moves a Trip between tabs after changing its transports and coming back", async () => {
      const list = vi.fn()
        .mockResolvedValueOnce({ ok: true, value: [dated(tripId, "Patagonia", "2099-01-09T10:00:00.000Z")] })
        .mockResolvedValue({ ok: true, value: [dated(tripId, "Patagonia", "2020-01-09T10:00:00.000Z")] });
      const container = await render("/trips", true, { list, get: async () => ({ ok: true, value: memberTrip }) },
        { listDestinations: async () => ({ ok: true, value: [] }), listTransports: async () => ({ ok: true, value: [] }) });
      expect(names(container)).toEqual(["Patagonia"]);
      await act(async () => container.querySelector<HTMLElement>(`a[href="/trips/${tripId}/journey"]`)?.click());
      expect(container.textContent).toContain("Destinos y transportes");
      await act(async () => backLink(container)?.click());
      expect(list).toHaveBeenCalledTimes(2);
      expect(names(container)).toEqual([]);
      await act(async () => tabButton(container, "Finalizados")?.click());
      expect(names(container)).toEqual(["Patagonia"]);
    });
  });
});

describe("App Trip routes: invitación por link", () => {
  it("conserva el texto y el código, y usa el panel y el contenedor de viajes", async () => {
    const joinByCode = vi.fn().mockResolvedValue({ ok: true, value: { tripId, joined: true } });
    const container = await render("/invite/VIAJE-X7K2", true, { joinByCode });
    expect(container.querySelector("h1")?.textContent).toBe("Unirse a un viaje");
    expect(container.querySelector("main.app-shell.trips-shell")).not.toBeNull();
    expect(container.querySelector("section.status-panel.invite-panel strong")?.textContent).toBe("VIAJE-X7K2");
    const confirm = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Confirmar unión");
    expect(confirm).toBeDefined();
    expect(joinByCode).not.toHaveBeenCalled();
    await act(async () => confirm?.click());
    expect(joinByCode).toHaveBeenCalledWith("VIAJE-X7K2");
    expect(container.textContent).toContain("Te uniste al viaje.");
  });
});
