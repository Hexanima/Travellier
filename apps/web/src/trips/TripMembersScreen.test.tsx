// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TripMembersScreen } from "./TripMembersScreen.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tripId = "507f191e810c19729de860ea";
const adminId = "507f1f77bcf86cd799439011";
const participantId = "507f1f77bcf86cd799439012";
const trip = { kind: "member", id: tripId, name: "Patagonia", description: null,
  primaryDestination: { name: "Bariloche" }, visibility: "private", inviteCode: "VIAJE-X7K2",
  votingEnabled: false, expenseMode: "register" };
const admin = { id: "507f1f77bcf86cd799439013", userId: adminId, name: "Nico", role: "admin", joinedAt: "2026-09-24T12:00:00.000Z" };
const participant = { id: "507f1f77bcf86cd799439014", userId: participantId, name: "Ana", role: "participant", joinedAt: "2026-09-24T13:00:00.000Z" };
const roots: ReturnType<typeof createRoot>[] = [];

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
});

const findButton = (container: HTMLElement, label: string) =>
  Array.from(container.querySelectorAll("button")).find((button) => button.textContent === label);

async function render(options: {
  viewerId?: string;
  get?: ReturnType<typeof vi.fn>;
  list?: ReturnType<typeof vi.fn>;
  expel?: ReturnType<typeof vi.fn>;
  copyText?: ReturnType<typeof vi.fn>;
  share?: ReturnType<typeof vi.fn>;
} = {}) {
  const get = options.get ?? vi.fn().mockResolvedValue({ ok: true, value: trip });
  const list = options.list ?? vi.fn().mockResolvedValue({ ok: true, value: { members: [admin, participant], currentUserId: options.viewerId ?? adminId } });
  const expel = options.expel ?? vi.fn().mockResolvedValue({ ok: true, value: undefined });
  const copyText = options.copyText ?? vi.fn().mockResolvedValue(undefined);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(
    <MemoryRouter initialEntries={[`/trips/${tripId}/members`]}>
      <Routes>
        <Route path="/trips/:tripId/members" element={<TripMembersScreen trips={{ get } as never}
          members={{ list, expel }} apiBaseUrl="https://api.example.test" sharing={{ copyText, share: options.share }} />} />
      </Routes>
    </MemoryRouter>,
  ));
  return { container, get, list, expel, copyText };
}

describe("TripMembersScreen", () => {
  it("shows the invitation and member list to a participant without expulsion controls", async () => {
    const { container, list } = await render({ viewerId: participantId });
    expect(list).toHaveBeenCalledWith(tripId);
    expect(container.textContent).toContain("VIAJE-X7K2");
    expect(container.textContent).toContain("Nico");
    expect(container.textContent).toContain("Ana");
    expect(container.textContent).not.toContain("Administración");
    expect(findButton(container, "Expulsar")).toBeUndefined();
  });

  it("requires confirmation and expels only a participant for an admin", async () => {
    const { container, expel } = await render();
    expect(container.textContent).toContain("Administración");
    expect(container.querySelectorAll("button[data-member-action=expel]")).toHaveLength(1);
    await act(async () => findButton(container, "Expulsar")?.click());
    expect(expel).not.toHaveBeenCalled();
    expect(container.getAttribute("role")).toBeNull();
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Ana");
    await act(async () => findButton(container, "Cancelar")?.click());
    expect(expel).not.toHaveBeenCalled();
    await act(async () => findButton(container, "Expulsar")?.click());
    await act(async () => findButton(container, "Confirmar expulsión")?.click());
    expect(expel).toHaveBeenCalledWith(tripId, participantId);
    expect(container.querySelector('[aria-label="Integrantes del viaje"]')?.textContent).not.toContain("Ana");
  });

  it("hides administration if the server rejects an expulsion after a role change", async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { members: [admin, participant], currentUserId: adminId } })
      .mockResolvedValueOnce({ ok: true, value: { members: [{ ...admin, role: "participant" }, participant], currentUserId: adminId } });
    const expel = vi.fn().mockResolvedValue({ ok: false, error: { kind: "forbidden" } });
    const { container } = await render({ list, expel });
    await act(async () => findButton(container, "Expulsar")?.click());
    await act(async () => findButton(container, "Confirmar expulsión")?.click());
    expect(list).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("Administración");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("permiso");
  });

  it("copies the code and shares the API invitation URL", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const { container, copyText } = await render({ share });
    await act(async () => findButton(container, "Copiar código")?.click());
    expect(copyText).toHaveBeenCalledWith("VIAJE-X7K2");
    await act(async () => findButton(container, "Compartir enlace")?.click());
    expect(share).toHaveBeenCalledWith({ title: "Patagonia", url: "https://api.example.test/invite/VIAJE-X7K2" });
  });

  it("copies the invitation URL when native sharing is unavailable", async () => {
    const { container, copyText } = await render();
    await act(async () => findButton(container, "Compartir enlace")?.click());
    expect(copyText).toHaveBeenCalledWith("https://api.example.test/invite/VIAJE-X7K2");
  });

  it("does not expose invitations or administration for a public preview", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: {
      kind: "public", id: tripId, name: "Patagonia", description: null,
      primaryDestination: { name: "Bariloche" }, visibility: "public",
    } });
    const { container, list } = await render({ get });
    expect(list).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("VIAJE-X7K2");
    expect(findButton(container, "Expulsar")).toBeUndefined();
  });
});
