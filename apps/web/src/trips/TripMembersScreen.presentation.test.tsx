// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TripMembersScreen } from "./TripMembersScreen.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tripId = "507f191e810c19729de860ea";
const ids = { owner: "507f1f77bcf86cd799439011", bea: "507f1f77bcf86cd799439012", ana: "507f1f77bcf86cd799439013" };
const trip = { kind: "member", id: tripId, name: "Patagonia", description: null, primaryDestination: { name: "Bariloche" }, visibility: "private", inviteCode: "VIAJE-X7K2", expenseMode: "register" };
const member = (key: keyof typeof ids, name: string, role: "admin" | "participant", isOwner = false) =>
  ({ id: `m-${key}`, userId: ids[key], name, role, isOwner, joinedAt: "2026-09-24T12:00:00.000Z" });
const roster = [member("owner", "Nico", "admin", true), member("bea", "Bea", "admin"), member("ana", "Ana", "participant")];
const roots: ReturnType<typeof createRoot>[] = [];

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
});

async function mount(viewer: keyof typeof ids, members = roster) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const api = {
    list: vi.fn().mockResolvedValue({ ok: true, value: { members, currentUserId: ids[viewer], ownerId: ids.owner } }),
    setRole: vi.fn(), transferOwnership: vi.fn(), leave: vi.fn(), expel: vi.fn(),
  };
  await act(async () => root.render(
    <MemoryRouter initialEntries={[`/trips/${tripId}/members`]}>
      <Routes>
        <Route path="/trips/:tripId/members" element={<TripMembersScreen trips={{ get: vi.fn().mockResolvedValue({ ok: true, value: trip }), deleteTrip: vi.fn() } as never} members={api as never} apiBaseUrl="https://api.example.test" />} />
      </Routes>
    </MemoryRouter>,
  ));
  return container;
}

const button = (label: string, scope: ParentNode = document) => Array.from(scope.querySelectorAll("button")).find((item) => item.textContent === label);
const click = (label: string) => act(async () => button(label)?.click());
const gestionar = (name: string) => act(async () => document.querySelector<HTMLButtonElement>(`[aria-label="Gestionar a ${name}"]`)?.click());
const inDialogLayer = () => document.querySelector(".members-dialog .ui-modal-backdrop [role=\"dialog\"]");

describe("Grupo: insignias de rol", () => {
  it("el titular lleva role-badge y role-badge--owner con texto; los demás solo role-badge", async () => {
    await mount("owner");
    const roles = Array.from(document.querySelectorAll(".trip-member-item .trip-member-role"));
    expect(roles.map((item) => item.textContent)).toEqual(["Titular", "Admin", "Participante"]);
    expect(roles.map((item) => item.classList.contains("role-badge"))).toEqual([true, true, true]);
    expect(roles.map((item) => item.classList.contains("role-badge--owner"))).toEqual([true, false, false]);
  });

  it("el primer hijo de cada fila sigue siendo el nombre y «Gestionar» es secundario", async () => {
    await mount("owner");
    expect(Array.from(document.querySelectorAll(".trip-member-item")).map((item) => item.firstElementChild?.textContent)).toEqual(["Nico (vos)", "Bea", "Ana"]);
    const manage = document.querySelector('[aria-label="Gestionar a Ana"]');
    expect(manage?.textContent).toBe("Gestionar");
    expect(manage?.classList.contains("ui-button--secondary")).toBe(true);
  });

  it("el código de invitación conserva su texto dentro de su tarjeta", async () => {
    await mount("ana");
    expect(document.querySelector(".trip-invite-code")?.textContent).toBe("VIAJE-X7K2");
  });
});

describe("Grupo: cada diálogo vive en su capa .members-dialog", () => {
  it("gestionar, rol, expulsión y transferencia", async () => {
    await mount("owner");
    await gestionar("Ana");
    expect(inDialogLayer()).not.toBeNull();
    await click("Hacer admin");
    expect(inDialogLayer()?.textContent).toContain("Cambiar rol");
    await click("Cancelar");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await gestionar("Ana");
    await click("Expulsar");
    expect(inDialogLayer()?.textContent).toContain("Expulsar participante");
    await click("Cancelar");
    await gestionar("Ana");
    await click("Transferir titularidad");
    expect(inDialogLayer()?.textContent).toContain("Transferir titularidad");
    expect(inDialogLayer()?.querySelector(".trip-members-ack")).not.toBeNull();
  });

  it("salir del viaje (integrante) y eliminar viaje (titular)", async () => {
    await mount("ana");
    await click("Salir del viaje");
    expect(inDialogLayer()?.textContent).toContain("¿Querés salir de este viaje?");
    await click("Cancelar");
    document.body.replaceChildren();
    await mount("owner");
    await click("Salir del viaje");
    expect(inDialogLayer()?.textContent).toContain("Sos el titular del viaje");
    await click("Cancelar");
    await act(async () => button("Eliminar viaje")?.click());
    expect(inDialogLayer()?.textContent).toContain("¿Querés eliminar Patagonia");
  });
});
