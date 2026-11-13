// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { err, NativeCapabilityError, ok } from "app-domain";
import { ExpenseForm } from "./ExpenseForm.js";
import { ExpenseSplitForm } from "./ExpenseSplitForm.js";
import { PostComposer } from "./PostComposer.js";
import { PostLinkPicker } from "./PostLinkPicker.js";
import { SpontaneousActivityForm } from "./SpontaneousActivityForm.js";
import { MemoriesLayout } from "./TripMemoriesScreen.js";
import { itineraryFixture, itineraryId } from "./itinerary-test-fixture.js";
import type { PostPhotoDeps } from "./use-post-photos.js";
import type { PostResponse } from "./trip-post-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const zone = "America/Argentina/Buenos_Aires";
const tripId = itineraryId(1), postId = itineraryId(30);
const newPath = `/trips/${tripId}/memories/new`, editPath = `/trips/${tripId}/memories/${postId}/edit`;
const saved = (extra: Partial<PostResponse> = {}): PostResponse => ({ id: postId, tripId, authorId: itineraryId(20), description: "Atardecer", mapsUrl: null,
  activityId: null, parentPostId: null, transportId: null, createdAt: "2026-09-25T13:00:00.123Z", ...extra });
function Listing() { const location = useLocation(); return <p data-testid="listing">LISTADO {JSON.stringify(location.state)}</p>; }
const [me, beto] = [itineraryId(40), itineraryId(41)];
const membersList = () => vi.fn().mockResolvedValue({ ok: true, value: { currentUserId: me, members: [{ id: itineraryId(100), userId: me, name: "Ana", role: "admin", joinedAt: "2026-01-01T00:00:00.000Z" },
  { id: itineraryId(101), userId: beto, name: "Beto", role: "participant", joinedAt: "2026-01-01T00:00:00.000Z" }] } });
const idsOf = (...values: string[]) => { const queue = [...values]; return vi.fn(() => queue.shift() ?? itineraryId(900 + queue.length)); };
const [ID1, ID2, ID3] = [itineraryId(71), itineraryId(72), itineraryId(73)];

type Overrides = Partial<Record<"create" | "update" | "get" | "itineraryGet", ReturnType<typeof vi.fn>>> & { newId?: () => string; photos?: PostPhotoDeps };
async function render(path: string, overrides: Overrides = {}) {
  const itineraryGet = overrides.itineraryGet ?? vi.fn().mockResolvedValue({ ok: true, value: itineraryFixture() });
  const itinerary = { get: itineraryGet };
  const create = overrides.create ?? vi.fn().mockResolvedValue({ ok: true, value: saved() });
  const update = overrides.update ?? vi.fn().mockResolvedValue({ ok: true, value: saved({ description: "Editado" }) });
  const get = overrides.get ?? vi.fn().mockResolvedValue({ ok: true, value: { post: saved(), parent: null, children: [], rootActivityId: null } });
  const list = vi.fn().mockResolvedValue({ ok: true, value: [] });
  const newId = overrides.newId ?? idsOf(ID1, ID2, ID3);
  const composer = <PostComposer posts={{ create, update, get }} itinerary={itinerary} timeZone={zone} newId={newId} {...(overrides.photos ? { photos: overrides.photos } : {})} />;
  const picker = <PostLinkPicker posts={{ list, get: vi.fn() }} itinerary={itinerary} timeZone={zone} spontaneousActivity />;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><nav><Link to={newPath}>nav-new</Link></nav><Routes>
    <Route path="/trips/:tripId/memories" element={<MemoriesLayout />}>
      <Route index element={<Listing />} />
      <Route path="new" element={composer} /><Route path=":postId/edit" element={composer} />
      <Route path="new/link" element={picker} /><Route path=":postId/edit/link" element={picker} />
      <Route path="new/expense" element={<ExpenseForm itinerary={itinerary} />} />
      <Route path="new/expense/split" element={<ExpenseSplitForm posts={{ get }} members={{ list: membersList() }} />} />
      <Route path="new/activity" element={<SpontaneousActivityForm itinerary={itinerary} timeZone={zone} />} />
      <Route path=":postId/edit/activity" element={<SpontaneousActivityForm itinerary={itinerary} timeZone={zone} />} />
      <Route path=":postId" element={<p>DETALLE</p>} />
    </Route></Routes></MemoryRouter>));
  return { container, create, update, get, itineraryGet, list, newId };
}
async function type(container: HTMLElement, name: string, value: string) {
  const element = container.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement;
  expect(element, `Field ${name}`).not.toBeNull();
  const proto = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
}
const submit = async (container: HTMLElement) => act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
const button = (container: ParentNode, label: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === label || item.getAttribute("aria-label") === label) as HTMLButtonElement | undefined;
const click = async (element: Element | undefined | null) => { expect(element).toBeTruthy(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); };
const link = (container: HTMLElement, label: string) => Array.from(container.querySelectorAll("a")).find((item) => item.textContent === label);
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
const body = (mock: ReturnType<typeof vi.fn>, call = 0) => mock.mock.calls[call]![1] as Record<string, unknown>;
const ids = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls.map((call) => (call[1] as { id?: string }).id);
const network = { ok: false, error: { kind: "network" } };
const scheduledAt = "2026-09-25T15:00:00.000Z";
const newActivityBody = { title: "Cena", scheduledAt, durationMinutes: 90 };
const activityResponse = { id: itineraryId(60), tripId, dayId: itineraryId(4), title: "Cena", description: null, mapsUrl: null, scheduledAt, durationMinutes: 90,
  createdAt: "2026-09-25T10:00:00.123Z", createdBy: itineraryId(20) };
const participation = { id: itineraryId(61), tripId, activityId: itineraryId(60), userId: itineraryId(20), status: "going", updatedAt: "2026-09-25T12:00:00.123Z" };
const withActivity = (extra: Partial<PostResponse> = {}) => ({ ...saved(extra), activity: activityResponse, participation });
const confirmation = { confirmedConflicts: [{ activityId: itineraryId(8), reason: "overlap" as const, scheduledAt: "2026-09-25T14:30:00.000Z", durationMinutes: 60 }],
  confirmedActivity: { scheduledAt, durationMinutes: 90 } };
const conflict = { ok: false, error: { kind: "participation-conflict", confirmation } };
const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
/** Opens the picker, then the subform from «Crear actividad espontánea», fills it and accepts: back at the composer. */
async function addActivity(container: HTMLElement) {
  await click(button(container, "Vincular a"));
  await click(Array.from(container.querySelectorAll("label")).find((item) => item.textContent?.trim().startsWith("Actividad"))?.querySelector("input"));
  await click(button(container, "Crear actividad espontánea"));
  await type(container, "title", "Cena"); await type(container, "date", "2026-09-25"); await type(container, "time", "12:00");
  await type(container, "durationHours", "1"); await type(container, "durationMinutes", "30");
  await click(button(container, "Aceptar"));
}
function makeDeps() {
  let reserved = 0;
  const queue: unknown[] = [];
  const source = { checkPermission: vi.fn(), select: vi.fn(async () => queue.length > 0 ? queue.shift() : err(new NativeCapabilityError("cancelled"))) };
  const reader = { read: vi.fn(async (photo: { reference: string }) => ok(new Blob([photo.reference], { type: "image/jpeg" }))) };
  const api = { reserve: vi.fn(async (_trip: string, files: readonly unknown[]) => ({ ok: true as const, value: files.map(() => { reserved += 1;
    return { key: `trips/${tripId}/photos/k${reserved}`, uploadUrl: `https://s3.test/k${reserved}`, headers: { "content-type": "image/jpeg" }, expiresAt: NOW + 900_000 }; }) })) };
  const transfer = { put: vi.fn(async () => ({ ok: true })) };
  const deps = { api, source, reader, transfer, now: () => NOW } as unknown as PostPhotoDeps;
  return { deps, api, transfer, offer: (n: number) => queue.push(ok([{ reference: `file:///${n}.jpg`, previewUrl: `https://localhost/_capacitor_file_/${n}.jpg`, format: "jpeg" }])) };
}
const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);

describe("PostComposer retry key (T88)", () => {
  it("the first publish sends a post id generated by the composer", async () => {
    const { container, create } = await render(newPath);
    await type(container, "description", "Hola"); await submit(container);
    expect(create).toHaveBeenCalledOnce();
    expect(body(create)).toEqual({ id: ID1, description: "Hola" });
  });
  it("the default generator makes a 24 hex lowercase id", async () => {
    const create = vi.fn().mockResolvedValue({ ok: true, value: saved() });
    const itinerary = { get: vi.fn().mockResolvedValue({ ok: true, value: itineraryFixture() }) };
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); roots.push(root);
    await act(async () => root.render(<MemoryRouter initialEntries={[newPath]}><Routes><Route path="/trips/:tripId/memories" element={<MemoriesLayout />}>
      <Route path="new" element={<PostComposer posts={{ create, update: vi.fn(), get: vi.fn() }} itinerary={itinerary} timeZone={zone} />} /></Route></Routes></MemoryRouter>));
    await type(container, "description", "Hola"); await submit(container);
    expect(body(create).id as string).toMatch(/^[0-9a-f]{24}$/);
  });
  it("a retry after a network failure sends the same id and body, reading nothing else and staying on the screen", async () => {
    const create = vi.fn().mockResolvedValueOnce(network).mockResolvedValue({ ok: true, value: saved() });
    const { container, itineraryGet, list } = await render(newPath, { create });
    await type(container, "description", "Hola"); await submit(container);
    expect(container.querySelector('[data-testid="listing"]')).toBeNull();
    expect(container.textContent).toContain("Podés reintentar: el recuerdo no se va a publicar dos veces.");
    expect(container.textContent).not.toContain("por si ya se publicó");
    await submit(container);
    expect(create).toHaveBeenCalledTimes(2);
    expect(body(create, 1)).toEqual(body(create, 0));
    expect(body(create, 1).id).toBe(ID1);
    expect(itineraryGet).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled();
  });
  // Un timeout del cliente llega al composer colapsado en `kind: "network"` porque los mapeadores de la API descartan `code`; por eso acá se fija que ese error conserva el hint de reintento y el id de T88.
  it("a client timeout keeps the retry hint and the same id (T146)", async () => {
    const create = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "network" } }).mockResolvedValue({ ok: true, value: saved() });
    const { container } = await render(newPath, { create });
    await type(container, "description", "Hola"); await submit(container);
    expect(container.querySelector('[data-testid="listing"]')).toBeNull();
    expect(container.textContent).toContain("Podés reintentar: el recuerdo no se va a publicar dos veces.");
    await submit(container);
    expect(ids(create)).toEqual([ID1, ID1]);
    expect(body(create, 1)).toEqual(body(create, 0));
  });
  it("a double tap sends a single create while the first one is pending", async () => {
    const pending = deferred<unknown>();
    const create = vi.fn().mockReturnValue(pending.promise);
    const { container } = await render(newPath, { create });
    await type(container, "description", "Hola"); await submit(container); await submit(container);
    expect(create).toHaveBeenCalledOnce();
    await act(async () => pending.resolve({ ok: true, value: saved() }));
  });
  it("a 5xx failure and a retry also reuse the id", async () => {
    const create = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "server" } }).mockResolvedValue({ ok: true, value: saved() });
    const { container } = await render(newPath, { create });
    await type(container, "description", "Hola"); await submit(container); await submit(container);
    expect(ids(create)).toEqual([ID1, ID1]);
  });
  it("changing the text after a failure keeps the id and sends the new body", async () => {
    const create = vi.fn().mockResolvedValueOnce(network).mockResolvedValue({ ok: true, value: saved() });
    const { container } = await render(newPath, { create });
    await type(container, "description", "Hola"); await submit(container);
    await type(container, "description", "Hola de nuevo"); await submit(container);
    expect(body(create, 1)).toEqual({ id: ID1, description: "Hola de nuevo" });
  });
  it("a validation failure keeps the id for the corrected retry", async () => {
    const create = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "validation", fields: [{ field: "description", code: "invalid", message: "x" }] } })
      .mockResolvedValue({ ok: true, value: saved() });
    const { container } = await render(newPath, { create });
    await type(container, "description", "Hola"); await submit(container);
    await type(container, "description", "Hola bien"); await submit(container);
    expect(ids(create)).toEqual([ID1, ID1]);
  });
  it("a 422 on the id itself drops it: the next attempt uses a fresh one", async () => {
    const create = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "validation", fields: [{ field: "id", code: "invalid", message: "x" }] } })
      .mockResolvedValue({ ok: true, value: saved() });
    const { container } = await render(newPath, { create });
    await type(container, "description", "Hola"); await submit(container);
    expect(container.textContent).toContain("Revisá los datos del recuerdo.");
    await submit(container);
    expect(ids(create)).toEqual([ID1, ID2]);
  });
  it("success drops the draft and its id: the next publication of the Trip gets another id", async () => {
    const newId = idsOf(ID1, ID2);
    const { container, create } = await render(newPath, { newId });
    await type(container, "description", "Hola"); await submit(container);
    expect(container.querySelector('[data-testid="listing"]')).not.toBeNull();
    expect(newId).toHaveBeenCalledTimes(1);
    await click(link(container, "nav-new"));
    await type(container, "description", "Otro"); await submit(container);
    expect(ids(create)).toEqual([ID1, ID2]);
  });
  it("Descartar leaves the draft; a new composer of the Trip starts without the old id", async () => {
    const create = vi.fn().mockResolvedValueOnce(network).mockResolvedValue({ ok: true, value: saved() });
    const newId = idsOf(ID1, ID2);
    const { container } = await render(newPath, { create, newId });
    await type(container, "description", "Hola"); await submit(container);
    await click(button(container, "Cancelar")); await click(button(container, "Descartar"));
    expect(container.querySelector('[data-testid="listing"]')).not.toBeNull();
    await click(link(container, "nav-new"));
    await type(container, "description", "Hola"); await submit(container);
    expect(ids(create)).toEqual([ID1, ID2]);
  });
  it("opening and leaving a subform keeps the same id for the next publish", async () => {
    const create = vi.fn().mockResolvedValueOnce(network).mockResolvedValue({ ok: true, value: saved() });
    const { container } = await render(newPath, { create });
    await type(container, "description", "Hola"); await submit(container);
    await click(button(container, "Vincular a"));
    expect(container.querySelector("form.post-composer")).toBeNull();
    await click(button(container, "Cancelar"));
    await submit(container);
    expect(ids(create)).toEqual([ID1, ID1]);
  });
  it("editing without a new activity sends no id at all and keeps the old retry hint", async () => {
    const update = vi.fn().mockResolvedValueOnce(network).mockResolvedValue({ ok: true, value: saved({ description: "Editado" }) });
    const { container, newId } = await render(editPath, { update });
    await type(container, "description", "Editado"); await submit(container);
    expect(update.mock.calls[0]![2]).toEqual({ description: "Editado" });
    expect(container.textContent).toContain("No pudimos guardar el recuerdo.");
    expect(newId).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Revisá tu conexión e intentá nuevamente.");
    expect(container.textContent).not.toContain("no se va a publicar dos veces");
  });
});

describe("PostComposer retry key with activity and photos (T88)", () => {
  const publishWithActivity = async (create: ReturnType<typeof vi.fn>, overrides: Overrides = {}) => {
    const view = await render(newPath, { create, ...overrides });
    await type(view.container, "description", "Hola"); await addActivity(view.container); await submit(view.container);
    return view;
  };
  it("a create with a new activity sends the post id and the activity without id", async () => {
    const create = vi.fn().mockResolvedValue({ ok: true, value: withActivity() });
    await publishWithActivity(create);
    expect(body(create)).toEqual({ id: ID1, description: "Hola", newActivity: newActivityBody });
  });
  it("cancelling the agenda modal and publishing again keeps the id and asks again; confirming resends the same input with the confirmation", async () => {
    const create = vi.fn().mockResolvedValueOnce(conflict).mockResolvedValueOnce(conflict).mockResolvedValue({ ok: true, value: withActivity() });
    const { container, itineraryGet } = await publishWithActivity(create);
    const loads = itineraryGet.mock.calls.length;
    await click(button(dialog()!, "Conservar mi participación actual"));
    expect(dialog()).toBeNull();
    expect(container.querySelector('[data-testid="listing"]')).toBeNull();
    await submit(container);
    expect(dialog()).not.toBeNull();
    await click(button(dialog()!, "Cambiar de plan"));
    expect(create).toHaveBeenCalledTimes(3);
    expect(ids(create)).toEqual([ID1, ID1, ID1]);
    expect(create.mock.calls[2]![1]).toEqual(create.mock.calls[0]![1]);
    expect(create.mock.calls[2]![2]).toEqual(confirmation);
    expect(create.mock.calls[0]![2]).toBeUndefined();
    expect(itineraryGet.mock.calls.length).toBe(loads);
    expect(container.querySelector('[data-testid="listing"]')).not.toBeNull();
  });
  it("a retry reuses the id, the activity and the very same photo keys without reserving again", async () => {
    const mocks = makeDeps();
    const create = vi.fn().mockResolvedValueOnce(network).mockResolvedValue({ ok: true, value: withActivity() });
    const { container } = await render(newPath, { create, photos: mocks.deps });
    await type(container, "description", "Hola"); await addActivity(container);
    mocks.offer(1); await click(button(container, "Agregar fotos"));
    await submit(container); await submit(container);
    expect(create).toHaveBeenCalledTimes(2);
    expect(body(create, 0)).toEqual({ id: ID1, description: "Hola", newActivity: newActivityBody, photos: [{ key: `trips/${tripId}/photos/k1` }] });
    expect(body(create, 1)).toEqual(body(create, 0));
    expect(mocks.api.reserve).toHaveBeenCalledTimes(1); expect(mocks.transfer.put).toHaveBeenCalledTimes(1);
  });
  it("relinking: the PATCH carries newActivity.id, no post id, and a retry reuses it", async () => {
    const update = vi.fn().mockResolvedValueOnce(network).mockResolvedValue({ ok: true, value: withActivity() });
    const { container } = await render(editPath, { update });
    await addActivity(container); await submit(container);
    expect(container.textContent).toContain("Podés reintentar: el recuerdo no se va a publicar dos veces.");
    await submit(container);
    expect(update.mock.calls[0]![2]).toEqual({ newActivity: { id: ID1, ...newActivityBody } });
    expect(update.mock.calls[1]![2]).toEqual(update.mock.calls[0]![2]);
    expect(container.querySelector('[data-testid="listing"]')?.textContent).toContain("linked-activity");
  });
  it("a 422 on newActivity.id drops it for the next attempt", async () => {
    const update = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "validation", fields: [{ field: "newActivity.id", code: "invalid", message: "x" }] } })
      .mockResolvedValue({ ok: true, value: withActivity() });
    const { container } = await render(editPath, { update });
    await addActivity(container); await submit(container);
    await submit(container);
    expect(update.mock.calls.map((call) => (call[2] as { newActivity: { id: string } }).newActivity.id)).toEqual([ID1, ID2]);
  });
});

describe("PostComposer request conflicts (T88)", () => {
  const alreadySaved = (postId?: string) => ({ ok: false, error: { kind: "already-saved", ...(postId ? { postId } : {}) } });
  const generic = { ok: false, error: { kind: "server", code: "PostRequestConflictError" } };
  const listingState = (container: HTMLElement) => JSON.parse(container.querySelector('[data-testid="listing"]')!.textContent!.replace(/^LISTADO /, "")) as Record<string, unknown>;
  it("already_saved on create: no second create, no extra reads, listing with the notice and the saved memory", async () => {
    const create = vi.fn().mockResolvedValue(alreadySaved(postId));
    const { container, itineraryGet, list, get } = await render(newPath, { create });
    await type(container, "description", "Hola"); await submit(container);
    expect(create).toHaveBeenCalledOnce();
    expect(listingState(container)).toEqual({ notice: "already-saved", postId });
    expect(itineraryGet).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
  });
  it("already_saved without a valid postId still goes to the listing with the notice only", async () => {
    const create = vi.fn().mockResolvedValue(alreadySaved());
    const { container } = await render(newPath, { create });
    await type(container, "description", "Hola"); await submit(container);
    expect(listingState(container)).toEqual({ notice: "already-saved" });
  });
  it("already_saved clears the draft and its id: a later publication starts clean with a new id", async () => {
    const create = vi.fn().mockResolvedValueOnce(alreadySaved(postId)).mockResolvedValue({ ok: true, value: saved() });
    const { container } = await render(newPath, { create });
    await type(container, "description", "Hola"); await submit(container);
    await click(link(container, "nav-new"));
    expect((container.querySelector('[name="description"]') as HTMLTextAreaElement).value).toBe("");
    await type(container, "description", "Otro"); await submit(container);
    expect(ids(create)).toEqual([ID1, ID2]);
  });
  it("already_saved with a new activity and confirmation does not republish nor ask again", async () => {
    const create = vi.fn().mockResolvedValueOnce(conflict).mockResolvedValue(alreadySaved(postId));
    const { container } = await render(newPath, { create });
    await type(container, "description", "Hola"); await addActivity(container); await submit(container);
    await click(button(dialog()!, "Cambiar de plan"));
    expect(create).toHaveBeenCalledTimes(2);
    expect(dialog()).toBeNull();
    expect(listingState(container)).toEqual({ notice: "already-saved", postId });
  });
  it("already_saved on a PATCH uses the memory of the route", async () => {
    const update = vi.fn().mockResolvedValue(alreadySaved(itineraryId(99)));
    const { container } = await render(editPath, { update });
    await addActivity(container); await submit(container);
    expect(update).toHaveBeenCalledOnce();
    expect(listingState(container)).toEqual({ notice: "already-saved", postId });
  });
  it("a generic 409 retries once, automatically, with a new id and the same content", async () => {
    const create = vi.fn().mockResolvedValueOnce(generic).mockResolvedValue({ ok: true, value: saved() });
    const { container } = await render(newPath, { create });
    await type(container, "description", "Hola"); await submit(container);
    expect(ids(create)).toEqual([ID1, ID2]);
    expect(body(create, 1)).toEqual({ id: ID2, description: "Hola" });
    expect(listingState(container)).toMatchObject({ notice: "created" });
  });
  it("a second generic 409 shows the generic error and stops retrying", async () => {
    const create = vi.fn().mockResolvedValue(generic);
    const { container } = await render(newPath, { create });
    await type(container, "description", "Hola"); await submit(container);
    expect(create).toHaveBeenCalledTimes(2);
    expect(ids(create)).toEqual([ID1, ID2]);
    expect(container.textContent).toContain("No pudimos guardar el recuerdo.");
    expect(container.querySelector('[data-testid="listing"]')).toBeNull();
    expect(container.querySelector("form")).not.toBeNull();
  });
  it("the automatic retry keeps the photo keys and the confirmation of the agenda", async () => {
    const mocks = makeDeps();
    const create = vi.fn().mockResolvedValueOnce(conflict).mockResolvedValueOnce(generic).mockResolvedValue({ ok: true, value: withActivity() });
    const { container } = await render(newPath, { create, photos: mocks.deps });
    await type(container, "description", "Hola"); await addActivity(container);
    mocks.offer(1); await click(button(container, "Agregar fotos"));
    await submit(container);
    await click(button(dialog()!, "Cambiar de plan"));
    expect(create).toHaveBeenCalledTimes(3);
    expect(ids(create)).toEqual([ID1, ID1, ID2]);
    expect(create.mock.calls[2]![2]).toEqual(confirmation);
    expect(body(create, 2).photos).toEqual(body(create, 0).photos);
    expect(mocks.api.reserve).toHaveBeenCalledTimes(1);
  });
  it("a generic 409 on a PATCH with a new activity retries once with a new activity id", async () => {
    const update = vi.fn().mockResolvedValueOnce(generic).mockResolvedValue({ ok: true, value: withActivity() });
    const { container } = await render(editPath, { update });
    await addActivity(container); await submit(container);
    expect(update.mock.calls.map((call) => (call[2] as { newActivity: { id: string } }).newActivity.id)).toEqual([ID1, ID2]);
    expect(listingState(container)).toMatchObject({ notice: "linked-activity" });
  });
  it("a generic 409 on a PATCH without an activity id is just a failure", async () => {
    const update = vi.fn().mockResolvedValue(generic);
    const { container } = await render(editPath, { update });
    await type(container, "description", "Editado"); await submit(container);
    expect(update).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("No pudimos guardar el recuerdo.");
  });
  it("with photos and a new activity a conflict never triggers a request other than create or update", async () => {
    const create = vi.fn().mockResolvedValue(alreadySaved(postId));
    const mocks = makeDeps();
    const { container, itineraryGet, list, get } = await render(newPath, { create, photos: mocks.deps });
    await type(container, "description", "Hola"); await addActivity(container);
    mocks.offer(1); await click(button(container, "Agregar fotos"));
    const reads = itineraryGet.mock.calls.length;
    await submit(container);
    expect(create).toHaveBeenCalledOnce();
    expect(itineraryGet.mock.calls.length).toBe(reads); expect(list).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
  });
});

describe("PostComposer complete publication scenarios (T88)", () => {
  const select = async (container: HTMLElement, name: string, value: string) => {
    const element = container.querySelector(`select[name="${name}"]`) as HTMLSelectElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("change", { bubbles: true })); });
  };
  const choose = async (container: HTMLElement, value: string) => select(container, "currency", value);
  const splitButton = (container: HTMLElement) => container.querySelector('button[name="split"]') as HTMLButtonElement;
  const expenseButton = (container: HTMLElement) => container.querySelector('button[name="expense"]') as HTMLButtonElement;
  /** Gasto of 100 ARS where Beto paid 60, shares as proposed (remainder for each member). */
  async function addExpenseWithSplit(container: HTMLElement) {
    await click(expenseButton(container)); await type(container, "amount", "100"); await choose(container, "ARS"); await click(button(container, "Aceptar"));
    await click(splitButton(container));
    await select(container, "payments-add", beto); await click(button(container, "Agregar pago"));
    const row = container.querySelector<HTMLElement>('[data-section="payments"] [data-row]')!;
    const input = row.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "60"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await click(button(container, "Aceptar"));
  }
  const expectedExpense = { totalAmount: 100, currency: "ARS", payments: [{ userId: beto, unit: "amount", value: 60 }],
    shares: [{ userId: me, unit: "remainder", value: null }, { userId: beto, unit: "remainder", value: null }] };
  const key1 = { key: `trips/${tripId}/photos/k1` };

  it("a spontaneous activity with photos and an expense with payments and shares is one POST with everything and no other request", async () => {
    const mocks = makeDeps();
    const create = vi.fn().mockResolvedValue({ ok: true, value: withActivity() });
    const { container, update, get, list } = await render(newPath, { create, photos: mocks.deps });
    await type(container, "description", "Cena");
    await addActivity(container);
    mocks.offer(1); await click(button(container, "Agregar fotos"));
    await addExpenseWithSplit(container);
    await submit(container);
    expect(create).toHaveBeenCalledOnce();
    expect(body(create)).toEqual({ id: ID1, description: "Cena", newActivity: newActivityBody, photos: [key1], expense: expectedExpense });
    expect(update).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled();
    expect(mocks.api.reserve).toHaveBeenCalledOnce(); expect(mocks.transfer.put).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-testid="listing"]')?.textContent).toContain("created-activity");
  });
  it("relinking an existing memory to a new activity is one PATCH with the activity id, without activityId or a post id", async () => {
    const update = vi.fn().mockResolvedValue({ ok: true, value: withActivity() });
    const get = vi.fn().mockResolvedValue({ ok: true, value: { post: saved({ activityId: itineraryId(8) }), parent: null, children: [], rootActivityId: itineraryId(8) } });
    const { container, create } = await render(editPath, { update, get });
    await addActivity(container); await submit(container);
    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0]![1]).toBe(postId);
    expect(update.mock.calls[0]![2]).toEqual({ newActivity: { id: ID1, ...newActivityBody } });
    expect(create).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="listing"]')?.textContent).toContain("linked-activity");
  });
  it("an agenda rejection has no partial effects: nothing is cleared, navigated or read; cancelling keeps everything and confirming resends the same input", async () => {
    const mocks = makeDeps();
    const create = vi.fn().mockResolvedValueOnce(conflict).mockResolvedValueOnce(conflict).mockResolvedValue({ ok: true, value: withActivity() });
    const { container, update, get, list } = await render(newPath, { create, photos: mocks.deps });
    await type(container, "description", "Cena");
    await addActivity(container);
    mocks.offer(1); await click(button(container, "Agregar fotos"));
    await addExpenseWithSplit(container);
    await submit(container);
    expect(dialog()).not.toBeNull();
    expect(container.querySelector('[data-testid="listing"]')).toBeNull();
    await click(button(dialog()!, "Conservar mi participación actual"));
    // Nothing was cleared: text, activity, photo and expense are still there.
    expect((container.querySelector('[name="description"]') as HTMLTextAreaElement).value).toBe("Cena");
    expect(container.querySelector("#post-link-summary")?.textContent).toContain("Actividad nueva: Cena");
    expect(container.querySelectorAll(".post-photos-section img")).toHaveLength(1);
    expect(container.querySelector("#post-expense-summary")?.textContent).toContain("Gasto:");
    expect(container.querySelector("#post-split-summary")).not.toBeNull();
    await submit(container);
    await click(button(dialog()!, "Cambiar de plan"));
    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls[1]![1]).toEqual(create.mock.calls[0]![1]);
    expect(create.mock.calls[2]![1]).toEqual(create.mock.calls[0]![1]);
    expect(body(create, 0)).toEqual({ id: ID1, description: "Cena", newActivity: newActivityBody, photos: [key1], expense: expectedExpense });
    expect(create.mock.calls[2]![2]).toEqual(confirmation);
    expect(mocks.api.reserve).toHaveBeenCalledOnce(); expect(mocks.transfer.put).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="listing"]')).not.toBeNull();
  });
});
