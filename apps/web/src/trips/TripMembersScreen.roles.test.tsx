// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TripMembersScreen } from "./TripMembersScreen.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tripId = "507f191e810c19729de860ea";
const ids = { owner: "507f1f77bcf86cd799439011", bea: "507f1f77bcf86cd799439012", ana: "507f1f77bcf86cd799439013", luz: "507f1f77bcf86cd799439014" };
const trip = { kind: "member", id: tripId, name: "Patagonia", description: null, primaryDestination: { name: "Bariloche" },
  visibility: "private", inviteCode: "VIAJE-X7K2", expenseMode: "register" };
const member = (key: keyof typeof ids, name: string, role: "admin" | "participant", isOwner = false) =>
  ({ id: `m-${key}`, userId: ids[key], name, role, isOwner, joinedAt: "2026-09-24T12:00:00.000Z" });
const nico = member("owner", "Nico", "admin", true), bea = member("bea", "Bea", "admin"), ana = member("ana", "Ana", "participant"), luz = member("luz", "Luz", "participant");
const listing = (members: unknown[], currentUserId: string, ownerId: string | null = ids.owner) => ({ ok: true, value: { members, currentUserId, ownerId } });
const roots: ReturnType<typeof createRoot>[] = [];

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
});

const button = (label: string, scope: ParentNode = document) =>
  Array.from(scope.querySelectorAll("button")).find((item) => item.textContent === label);
const click = (label: string) => act(async () => button(label)?.click());
const dialog = () => document.querySelector('[role="dialog"]');
const alertText = () => document.querySelector('[role="alert"]')?.textContent ?? "";
const gestionar = (name: string) => act(async () => document.querySelector<HTMLButtonElement>(`[aria-label="Gestionar a ${name}"]`)?.click());
const acknowledge = () => act(async () => document.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')?.click());
const badges = () => Array.from(document.querySelectorAll(".trip-member-item")).map((item) => item.querySelector(".trip-member-role")?.textContent);
const names = () => Array.from(document.querySelectorAll(".trip-member-item")).map((item) => item.firstElementChild?.textContent);

type Api = Record<"setRole" | "transferOwnership" | "leave" | "expel", ReturnType<typeof vi.fn>>;

async function mount(viewer: keyof typeof ids, options: { members?: unknown[]; list?: ReturnType<typeof vi.fn>; ownerId?: string | null; api?: Partial<Api> } = {}) {
  const members = options.members ?? [nico, bea, ana, luz];
  const list = options.list ?? vi.fn().mockResolvedValue(listing(members, ids[viewer], options.ownerId));
  const api: Api = {
    setRole: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    transferOwnership: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    leave: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    expel: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    ...options.api,
  };
  const deleteTrip = vi.fn().mockResolvedValue({ ok: true, value: undefined });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(
    <MemoryRouter initialEntries={[`/trips/${tripId}/members`]}>
      <Routes>
        <Route path="/trips/:tripId/members" element={<TripMembersScreen trips={{ get: vi.fn().mockResolvedValue({ ok: true, value: trip }), deleteTrip } as never}
          members={{ list, ...api } as never} apiBaseUrl="https://api.example.test" />} />
        <Route path="/trips" element={<h1>Mis viajes</h1>} />
      </Routes>
    </MemoryRouter>,
  ));
  return { container, list, deleteTrip, ...api };
}

describe("members: what each role sees", () => {
  it("owner: titular and admin badges, manage everyone else, delete and leave", async () => {
    await mount("owner");
    expect(badges()).toEqual(["Titular", "Admin", "Participante", "Participante"]);
    expect(document.querySelector('[aria-label="Gestionar a Nico"]')).toBeNull();
    expect(document.querySelectorAll("button[data-member-action=manage]")).toHaveLength(3);
    expect(button("Eliminar viaje")).toBeDefined();
    expect(button("Salir del viaje")).toBeDefined();
  });

  it("owner: the manage dialog offers role, transfer and expel according to the target", async () => {
    await mount("owner");
    await gestionar("Ana");
    expect(["Hacer admin", "Transferir titularidad", "Expulsar"].map((label) => button(label, dialog()!) !== undefined)).toEqual([true, true, true]);
    expect(button("Quitar admin", dialog()!)).toBeUndefined();
    await click("Cancelar");
    await gestionar("Bea");
    expect(button("Quitar admin", dialog()!)).toBeDefined();
    expect(button("Hacer admin", dialog()!)).toBeUndefined();
  });

  it("non-owner admin: manages participants only and only expels; no delete", async () => {
    await mount("bea");
    expect(Array.from(document.querySelectorAll("button[data-member-action=manage]")).map((item) => item.getAttribute("aria-label"))).toEqual(["Gestionar a Ana", "Gestionar a Luz"]);
    expect(button("Eliminar viaje")).toBeUndefined();
    await gestionar("Ana");
    expect(button("Expulsar", dialog()!)).toBeDefined();
    expect(button("Hacer admin", dialog()!)).toBeUndefined();
    expect(button("Transferir titularidad", dialog()!)).toBeUndefined();
    await click("Cancelar");
    expect(button("Salir del viaje")).toBeDefined();
  });

  it("participant: no management and no deletion, but can leave", async () => {
    await mount("ana");
    expect(document.querySelector("button[data-member-action=manage]")).toBeNull();
    expect(button("Eliminar viaje")).toBeUndefined();
    expect(button("Salir del viaje")).toBeDefined();
  });

  it("without a known owner it offers expulsion by role only and never owner actions", async () => {
    await mount("bea", { ownerId: null });
    await gestionar("Ana");
    expect(button("Expulsar", dialog()!)).toBeDefined();
    expect(button("Transferir titularidad", dialog()!)).toBeUndefined();
    await click("Cancelar");
    expect(button("Eliminar viaje")).toBeUndefined();
  });
});

describe("members: owner actions", () => {
  it("confirms a role change naming the person, then updates the badge; cancelling does nothing", async () => {
    const { setRole } = await mount("owner");
    await gestionar("Ana");
    await click("Hacer admin");
    expect(dialog()?.textContent).toContain("Ana");
    await click("Cancelar");
    expect(setRole).not.toHaveBeenCalled();
    await gestionar("Ana");
    await click("Hacer admin");
    await click("Confirmar cambio de rol");
    expect(setRole).toHaveBeenCalledWith(tripId, ids.ana, "admin");
    expect(dialog()).toBeNull();
    expect(badges()[2]).toBe("Admin");
  });

  it("removes admin from another admin", async () => {
    const { setRole } = await mount("owner");
    await gestionar("Bea");
    await click("Quitar admin");
    await click("Confirmar cambio de rol");
    expect(setRole).toHaveBeenCalledWith(tripId, ids.bea, "participant");
    expect(badges()[1]).toBe("Participante");
  });

  it("transfers ownership only after the acknowledgement and refreshes the list", async () => {
    const list = vi.fn().mockResolvedValueOnce(listing([nico, bea, ana, luz], ids.owner))
      .mockResolvedValueOnce(listing([{ ...nico, isOwner: false }, { ...bea, isOwner: true }, ana, luz], ids.owner, ids.bea));
    const { transferOwnership } = await mount("owner", { list });
    await gestionar("Bea");
    await click("Transferir titularidad");
    expect(dialog()?.textContent).toContain("Bea");
    expect(dialog()?.textContent).toContain("seguirás como admin");
    expect(button("Confirmar transferencia")?.disabled).toBe(true);
    await acknowledge();
    await click("Confirmar transferencia");
    expect(transferOwnership).toHaveBeenCalledWith(tripId, ids.bea);
    expect(list).toHaveBeenCalledTimes(2);
    expect(dialog()).toBeNull();
    expect(badges().slice(0, 2)).toEqual(["Admin", "Titular"]);
    expect(button("Eliminar viaje")).toBeUndefined();
    expect(document.querySelector('[aria-label="Gestionar a Bea"]')).toBeNull();
  });

  it("the owner who leaves must transfer or delete: both are offered and nothing is left yet", async () => {
    const { leave, deleteTrip } = await mount("owner");
    await click("Salir del viaje");
    expect(button("Confirmar salida")).toBeUndefined();
    expect(button("Transferir titularidad", dialog()!)).toBeDefined();
    await act(async () => button("Eliminar viaje", dialog()!)?.click());
    expect(dialog()?.textContent).toContain("Patagonia");
    await click("Eliminar definitivamente");
    expect(deleteTrip).toHaveBeenCalledWith(tripId);
    expect(leave).not.toHaveBeenCalled();
    expect(document.body.textContent).toBe("Mis viajes");
  });

  it("the owner who leaves can choose the recipient among the other members", async () => {
    const { transferOwnership } = await mount("owner");
    await click("Salir del viaje");
    await click("Transferir titularidad");
    expect(button("Confirmar transferencia")?.disabled).toBe(true);
    const select = document.querySelector<HTMLSelectElement>('[role="dialog"] select')!;
    expect(Array.from(select.options).map((option) => option.textContent)).not.toContain("Nico");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      setter.call(select, ids.luz);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await acknowledge();
    await click("Confirmar transferencia");
    expect(transferOwnership).toHaveBeenCalledWith(tripId, ids.luz);
  });

  it("the sole-member owner can only delete the Trip", async () => {
    await mount("owner", { members: [nico] });
    await click("Salir del viaje");
    expect(button("Transferir titularidad", dialog()!)).toBeUndefined();
    expect(button("Eliminar viaje", dialog()!)).toBeDefined();
  });
});

describe("members: leaving", () => {
  it("asks for confirmation, then goes to My Trips without Trip data", async () => {
    const { leave } = await mount("ana");
    await click("Salir del viaje");
    expect(dialog()?.textContent).toContain("ex integrante");
    await click("Cancelar");
    expect(leave).not.toHaveBeenCalled();
    await click("Salir del viaje");
    await click("Confirmar salida");
    expect(leave).toHaveBeenCalledWith(tripId);
    expect(document.body.textContent).toBe("Mis viajes");
  });

  it.each([
    ["leave", "ana"], ["setRole", "owner"], ["transfer", "owner"], ["expel", "owner"],
  ] as const)("a double click on %s sends a single request", async (op, viewer) => {
    let complete!: (value: unknown) => void;
    const pending = vi.fn().mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    await mount(viewer, { api: { leave: pending, setRole: pending, transferOwnership: pending, expel: pending } });
    if (op === "leave") await click("Salir del viaje");
    else {
      await gestionar("Ana");
      await click(op === "setRole" ? "Hacer admin" : op === "transfer" ? "Transferir titularidad" : "Expulsar");
      if (op === "transfer") await acknowledge();
    }
    const confirm = button(op === "leave" ? "Confirmar salida" : op === "setRole" ? "Confirmar cambio de rol" : op === "transfer" ? "Confirmar transferencia" : "Confirmar expulsión");
    await act(async () => { confirm?.click(); confirm?.click(); });
    expect(pending).toHaveBeenCalledTimes(1);
    expect(document.querySelector<HTMLFieldSetElement>('[role="dialog"] fieldset')?.disabled ?? true).toBe(true);
    await act(async () => complete({ ok: true, value: undefined }));
  });
});

type Op = { name: string; viewer: keyof typeof ids; method: "setRole" | "transferOwnership" | "leave" | "expel" | "deleteTrip"; run: () => Promise<void> };
const ops: Op[] = [
  { name: "role", viewer: "owner", method: "setRole", run: async () => { await gestionar("Ana"); await click("Hacer admin"); await click("Confirmar cambio de rol"); } },
  { name: "transfer", viewer: "owner", method: "transferOwnership", run: async () => {
    await gestionar("Ana"); await click("Transferir titularidad"); await acknowledge(); await click("Confirmar transferencia"); } },
  { name: "expel", viewer: "owner", method: "expel", run: async () => { await gestionar("Ana"); await click("Expulsar"); await click("Confirmar expulsión"); } },
  { name: "leave", viewer: "ana", method: "leave", run: async () => { await click("Salir del viaje"); await click("Confirmar salida"); } },
  { name: "delete", viewer: "owner", method: "deleteTrip", run: async () => { await click("Eliminar viaje"); await click("Eliminar definitivamente"); } },
];

describe.each(ops)("members: rejections on $name", ({ viewer, method, run }) => {
  const withFailure = async (error: unknown, reloaded: unknown) => {
    const list = vi.fn().mockResolvedValueOnce(listing([nico, bea, ana, luz], ids[viewer])).mockResolvedValue(reloaded);
    const failing = vi.fn().mockResolvedValue({ ok: false, error });
    const view = await mount(viewer, { list, api: method === "deleteTrip" ? {} : { [method]: failing } });
    if (method === "deleteTrip") view.deleteTrip.mockImplementation(failing);
    await run();
    return { list, failing };
  };
  const changed = () => listing([{ ...nico, isOwner: false }, { ...bea, isOwner: true }, ana, luz], ids[viewer], ids.bea);

  it.each(["forbidden", "not-found"])("%s with a reloadable list closes the dialog, warns and refreshes", async (kind) => {
    const { list, failing } = await withFailure({ kind }, changed());
    expect(failing).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(2);
    expect(dialog()).toBeNull();
    expect(document.body.textContent).toContain("Tu permiso cambió. Actualizamos los integrantes.");
    expect(button("Eliminar viaje")).toBeUndefined();
  });

  it("not-found when the person is no longer a member says so", async () => {
    await withFailure({ kind: "not-found" }, listing([nico, bea, ana, luz].filter((item) => item.userId !== ids[viewer]), ids[viewer]));
    expect(document.body.textContent).toContain("ya no sos integrante");
    expect(dialog()).toBeNull();
  });

  it("409 owner protected reloads and tells the owner to transfer or delete", async () => {
    await withFailure({ kind: "conflict", code: "TripOwnerProtectedError" }, listing([nico, bea, ana, luz], ids[viewer]));
    expect(dialog()).toBeNull();
    expect(document.body.textContent).toContain("El titular debe transferir o eliminar el viaje.");
  });

  it("un timeout tiene su propio texto dentro del diálogo, que sigue abierto (T150)", async () => {
    await withFailure({ kind: "network", code: "TimeoutError" }, listing([nico, bea, ana, luz], ids[viewer]));
    expect(dialog()).not.toBeNull();
    expect(alertText()).toContain("La conexión tardó demasiado. Intentá nuevamente.");
  });

  it("una conexión caída conserva el texto de siempre (T150)", async () => {
    await withFailure({ kind: "network", code: "NetworkError" }, listing([nico, bea, ana, luz], ids[viewer]));
    expect(alertText()).not.toContain("tardó demasiado");
    expect(alertText()).toContain("Intentá nuevamente");
  });

  it("a network failure stays inside the dialog and can be retried", async () => {
    const { list, failing } = await withFailure({ kind: "network" }, listing([nico, bea, ana, luz], ids[viewer]));
    expect(dialog()).not.toBeNull();
    expect(alertText()).toContain("Intentá nuevamente");
    expect(list).toHaveBeenCalledTimes(1);
    expect(names().length).toBeGreaterThan(0);
    failing.mockResolvedValue({ ok: true, value: undefined });
    const confirm = Array.from(document.querySelectorAll('[role="dialog"] button'))
      .filter((item) => /^Confirmar|^Eliminar definitivamente$/.test(item.textContent ?? "")).at(-1) as HTMLButtonElement;
    await act(async () => confirm.click());
    expect(failing).toHaveBeenCalledTimes(2);
    expect(dialog()).toBeNull();
  });
});

describe("members: rejections on transfer (same_owner)", () => {
  it("same_owner closes the dialog, says the person is already titular and refreshes the list", async () => {
    const list = vi.fn().mockResolvedValueOnce(listing([nico, bea, ana, luz], ids.owner)).mockResolvedValue(listing([{ ...nico, isOwner: false }, { ...bea, isOwner: true }, ana, luz], ids.owner, ids.bea));
    const failing = vi.fn().mockResolvedValue({ ok: false, error: { kind: "validation", code: "same_owner" } });
    await mount("owner", { list, api: { transferOwnership: failing } });
    await gestionar("Bea"); await click("Transferir titularidad"); await acknowledge(); await click("Confirmar transferencia");
    expect(failing).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(2);
    expect(dialog()).toBeNull();
    expect(document.body.textContent).toContain("Esa persona ya es titular. Actualizamos los integrantes.");
  });
});
