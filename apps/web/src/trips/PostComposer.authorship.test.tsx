// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExpenseForm } from "./ExpenseForm.js";
import { PostComposer } from "./PostComposer.js";
import { ignoreRetryIds } from "./post-composer-test-api.js";
import { MemoriesLayout } from "./TripMemoriesScreen.js";
import { itineraryFixture, itineraryId } from "./itinerary-test-fixture.js";
import type { PostResponse } from "./trip-post-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const zone = "America/Argentina/Buenos_Aires";
const tripId = itineraryId(1), postId = itineraryId(10), author = itineraryId(20), someone = itineraryId(21), stranger = itineraryId(22);
const saved = (extra: Partial<PostResponse> = {}): PostResponse => ({ id: postId, tripId, authorId: author, description: "Atardecer", mapsUrl: "https://maps.app.goo.gl/abc",
  activityId: null, parentPostId: itineraryId(12), transportId: null, createdAt: "2026-09-25T13:00:00.123Z", ...extra });
const editPath = `/trips/${tripId}/memories/${postId}/edit`;
function Listing() { const location = useLocation(); return <p data-testid="listing">LISTADO {JSON.stringify(location.state)}</p>; }
/** `stranger` is not listed: the viewer who is not a current member of the Trip anymore. */
const membersFor = (currentUserId: string) => vi.fn().mockResolvedValue({ ok: true, value: { currentUserId, members: [
  { id: itineraryId(100), userId: author, name: "Ana", role: "admin", joinedAt: "2026-01-01T00:00:00.000Z" },
  { id: itineraryId(101), userId: someone, name: "Beto", role: "participant", joinedAt: "2026-01-01T00:00:00.000Z" }] } });
async function render(currentUser: string, mocks: { update?: ReturnType<typeof vi.fn>; post?: PostResponse; state?: unknown; membersFail?: boolean } = {}) {
  const itinerary = { get: vi.fn().mockResolvedValue({ ok: true, value: itineraryFixture() }) };
  const update = mocks.update ?? vi.fn().mockResolvedValue({ ok: true, value: saved() });
  const get = vi.fn().mockResolvedValue({ ok: true, value: { post: mocks.post ?? saved(), parent: null, children: [], rootActivityId: null } });
  const list = mocks.membersFail ? vi.fn().mockResolvedValue({ ok: false, error: { kind: "server" } }) : membersFor(currentUser);
  const composer = <PostComposer posts={ignoreRetryIds({ create: vi.fn(), update, get })} itinerary={itinerary} members={{ list }} timeZone={zone} />;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[{ pathname: editPath, state: mocks.state }]}><Routes>
    <Route path="/trips/:tripId/memories" element={<MemoriesLayout />}>
      <Route index element={<Listing />} />
      <Route path=":postId/edit" element={composer} />
      <Route path=":postId/edit/expense" element={<ExpenseForm itinerary={itinerary} />} />
    </Route></Routes></MemoryRouter>));
  return { container, update, list };
}
const type = async (container: HTMLElement, name: string, value: string) => {
  const element = container.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement;
  expect(element, `Field ${name}`).not.toBeNull();
  const proto = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
};
const choose = async (container: HTMLElement, value: string) => {
  const element = container.querySelector('select[name="currency"]') as HTMLSelectElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("change", { bubbles: true })); });
};
const submit = async (container: HTMLElement) => act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
const button = (container: ParentNode, label: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === label) as HTMLButtonElement | undefined;
const click = async (element: Element | undefined | null) => { expect(element).toBeTruthy(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); };
const alerts = (container: HTMLElement) => Array.from(container.querySelectorAll('[role="alert"]')).map((item) => item.textContent);
const lockedNotice = "Solo el autor puede editar el contenido; podés editar el gasto y el reparto.";

describe.each([["another member", someone], ["a former member", stranger]])("PostComposer content locked for %s (T125)", (_name, user) => {
  it("shows the content read-only, without photos or link, with the notice and the expense section active", async () => {
    const { container } = await render(user);
    expect(container.querySelector("h1")?.textContent).toBe("Editar gasto del recuerdo");
    expect(container.querySelector('[name="description"]')).toBeNull();
    expect(container.querySelector('[name="mapsUrl"]')).toBeNull();
    expect(container.querySelector('section[aria-label="Vínculo"]')).toBeNull();
    expect(button(container, "Vincular a")).toBeUndefined();
    expect(container.textContent).toContain("Atardecer");
    expect(container.textContent).toContain(lockedNotice);
    expect(container.querySelector('section[aria-label="Gasto"]')).not.toBeNull();
    expect(button(container, "Pagos y reparto")).toBeTruthy();
  });
  it("puts the initial focus on the expense button when opened with the expense focus", async () => {
    const { container } = await render(user, { state: { focus: "expense" } });
    expect(document.activeElement).toBe(container.querySelector('button[name="expense"]'));
  });
  it("saves the expense with exactly {expense}: no description, maps, links, photos or new activity", async () => {
    const { container, update } = await render(user);
    await click(container.querySelector('button[name="expense"]'));
    await type(container, "amount", "30");
    await choose(container, "ARS");
    await click(button(container, "Aceptar"));
    await submit(container);
    expect(update).toHaveBeenCalledTimes(1);
    const input = update.mock.calls[0]![2] as Record<string, unknown>;
    expect(Object.keys(input)).toEqual(["expense"]);
    expect(container.querySelector('[data-testid="listing"]')).not.toBeNull();
  });
  it("says there is nothing to save when the expense did not change", async () => {
    const { container, update } = await render(user);
    await submit(container);
    expect(update).not.toHaveBeenCalled();
    expect(container.textContent).toContain("No hay cambios para guardar.");
  });
});

describe("PostComposer content for the author (T125)", () => {
  it("keeps the editable form and the full save", async () => {
    const { container, update } = await render(author);
    expect(container.querySelector("h1")?.textContent).toBe("Editar recuerdo");
    expect(container.querySelector('[name="description"]')).not.toBeNull();
    expect(container.querySelector('section[aria-label="Vínculo"]')).not.toBeNull();
    expect(container.textContent).not.toContain(lockedNotice);
    await type(container, "description", "Editado");
    await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, { description: "Editado" });
  });
  it("keeps the editable form while the member list is unknown", async () => {
    const { container } = await render(author, { membersFail: true });
    expect(container.querySelector('[name="description"]')).not.toBeNull();
  });
  it("a 403 shows the authorship message, keeps the form and the draft and does not say the memory is unavailable", async () => {
    const update = vi.fn().mockResolvedValue({ ok: false, error: { kind: "forbidden" } });
    const { container } = await render(author, { update, membersFail: true });
    await type(container, "description", "Mi borrador");
    await submit(container);
    expect(alerts(container)).toContain("Solo el autor puede editar el contenido de este recuerdo. Tu borrador se conserva.");
    expect(container.textContent).not.toContain("ya no está disponible");
    expect((container.querySelector('[name="description"]') as HTMLTextAreaElement).value).toBe("Mi borrador");
    expect(button(container, "Guardar cambios")).toBeTruthy();
    expect(container.textContent).not.toContain("No pudimos guardar el recuerdo");
  });
  it("a 404 keeps blocking the form as unavailable", async () => {
    const update = vi.fn().mockResolvedValue({ ok: false, error: { kind: "not-found" } });
    const { container } = await render(author, { update });
    await type(container, "description", "Mi borrador");
    await submit(container);
    expect(container.textContent).toContain("Este recuerdo ya no está disponible para tu cuenta.");
    expect(container.querySelector("form")).toBeNull();
  });
});

describe.each([["another member", someone], ["a former member", stranger]])("PostComposer removing the expense as %s (T128)", (_name, user) => {
  const removedText = "Gasto: se quitará al guardar. Dejará de figurar en el registro y en el balance.";
  it("offers Quitar gasto and sends only expense: null", async () => {
    const { container, update } = await render(user);
    expect(container.textContent).not.toContain("no se puede quitar");
    await click(button(container, "Quitar gasto"));
    expect(container.querySelector("#post-expense-summary")?.textContent).toBe(removedText);
    await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, { expense: null });
  });
  it("Conservar gasto undoes it", async () => {
    const { container, update } = await render(user);
    await click(button(container, "Quitar gasto")); await click(button(container, "Conservar gasto"));
    await submit(container);
    expect(update).not.toHaveBeenCalled();
  });
});
describe("PostComposer removing the expense as the author (T128)", () => {
  it("offers Quitar gasto to the author too", async () => {
    const { container, update } = await render(author);
    await click(button(container, "Quitar gasto"));
    await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, { expense: null });
  });
});
