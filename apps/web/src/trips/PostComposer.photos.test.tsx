// @vitest-environment jsdom
import { err, NativeCapabilityError, ok } from "app-domain";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UploadOutcome } from "../api/direct-upload.js";
import { PhotoReadError } from "../native/photo-file.js";
import { PostComposer } from "./PostComposer.js";
import { ignoreRetryIds } from "./post-composer-test-api.js";
import { PostLinkPicker } from "./PostLinkPicker.js";
import { SpontaneousActivityForm } from "./SpontaneousActivityForm.js";
import { MemoriesLayout } from "./TripMemoriesScreen.js";
import { itineraryFixture, itineraryId } from "./itinerary-test-fixture.js";
import type { PostPhotoDeps } from "./use-post-photos.js";
import type { PostResponse } from "./trip-post-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
const tripId = itineraryId(1), otherTripId = itineraryId(2), postId = itineraryId(30), transportId = itineraryId(50);
const newPath = `/trips/${tripId}/memories/new`, editPath = `/trips/${tripId}/memories/${postId}/edit`;
const timeZone = "America/Argentina/Buenos_Aires";
const saved = (extra: Partial<PostResponse> = {}): PostResponse => ({ id: postId, tripId, authorId: itineraryId(20), description: "Atardecer", mapsUrl: null,
  activityId: null, parentPostId: null, transportId: null, createdAt: "2026-01-02T15:30:00.000Z", ...extra });
function Listing() { const location = useLocation(); return <p data-testid="listing">LISTADO {JSON.stringify(location.state)}</p>; }
const selected = (n: number) => ({ reference: `file:///${n}.jpg`, previewUrl: `https://localhost/_capacitor_file_/${n}.jpg`, format: "jpeg" });

type Log = string[];
function makeDeps(log: Log = []) {
  let reserved = 0;
  const queue: unknown[] = [];
  const source = { checkPermission: vi.fn(), select: vi.fn(async () => queue.length > 0 ? queue.shift() : err(new NativeCapabilityError("cancelled"))) };
  const reader = { read: vi.fn(async (photo: { reference: string }) => ok(new Blob([photo.reference], { type: "image/jpeg" }))) };
  const api = { reserve: vi.fn(async (_trip: string, files: readonly unknown[]) => {
    log.push(`reserve:${files.length}`);
    return { ok: true as const, value: files.map(() => { reserved += 1; return { key: `trips/${tripId}/photos/k${reserved}`, uploadUrl: `https://s3.test/k${reserved}`, headers: { "content-type": "image/jpeg" }, expiresAt: NOW + 900_000 }; }) };
  }) };
  const transfer = { put: vi.fn(async (url: string): Promise<UploadOutcome> => { log.push(`put:${url.split("/").pop()}`); return { ok: true }; }) };
  const deps = { api, source, reader, transfer, now: () => NOW } as unknown as PostPhotoDeps;
  return { deps, source, reader, api, transfer, log, offer: (...numbers: number[]) => queue.push(ok(numbers.map(selected))), offerError: (kind: "cancelled" | "denied" | "unsupported" | "native") => queue.push(err(new NativeCapabilityError(kind))) };
}
type Mocks = ReturnType<typeof makeDeps>;
async function render(path: string, mocks: Mocks | undefined, overrides: Partial<Record<"create" | "update" | "get", ReturnType<typeof vi.fn>>> = {}, members?: { list: ReturnType<typeof vi.fn> }) {
  const itinerary = { get: vi.fn().mockResolvedValue({ ok: true, value: itineraryFixture() }) };
  const create = overrides.create ?? vi.fn().mockResolvedValue({ ok: true, value: saved() });
  const update = overrides.update ?? vi.fn().mockResolvedValue({ ok: true, value: saved({ description: "Editado" }) });
  const get = overrides.get ?? vi.fn().mockResolvedValue({ ok: true, value: { post: saved(), parent: null, children: [], rootActivityId: null } });
  const picker = <PostLinkPicker posts={{ list: vi.fn().mockResolvedValue({ ok: true, value: [] }), get: vi.fn() }} itinerary={itinerary} timeZone={timeZone} spontaneousActivity />;
  const subform = <SpontaneousActivityForm itinerary={itinerary} timeZone={timeZone} />;
  const composer = <PostComposer posts={ignoreRetryIds({ create, update, get })} itinerary={itinerary} timeZone={timeZone} {...(mocks ? { photos: mocks.deps } : {})} {...(members ? { members } : {})} />;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}>
    <nav><Link to={newPath}>nav-new</Link><Link to={editPath}>nav-edit</Link><Link to={`/trips/${otherTripId}/memories/new`}>nav-other</Link></nav>
    <Routes>
      <Route path="/trips/:tripId/memories" element={<MemoriesLayout />}>
        <Route index element={<Listing />} />
        <Route path="new" element={composer} />
        <Route path=":postId/edit" element={composer} />
        <Route path="new/link" element={picker} />
        <Route path="new/activity" element={subform} />
        <Route path=":postId/edit/link" element={picker} />
        <Route path=":postId/edit/activity" element={subform} />
      </Route>
      <Route path="/login" element={<p>LOGIN</p>} />
    </Routes></MemoryRouter>));
  return { container, create, update, get };
}
async function field(container: HTMLElement, name: string, value: string) {
  const element = container.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement;
  expect(element, `Field ${name}`).not.toBeNull();
  const proto = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
}
const submit = async (container: HTMLElement) => act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
const button = (container: ParentNode, label: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === label || item.getAttribute("aria-label") === label) as HTMLButtonElement | undefined;
const click = async (element: Element | undefined) => { expect(element).toBeDefined(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); };
const value = (container: HTMLElement, name: string) => (container.querySelector(`[name="${name}"]`) as HTMLInputElement).value;
const alerts = (container: HTMLElement) => Array.from(container.querySelectorAll('[role="alert"]'));
const section = (container: HTMLElement) => container.querySelector(".post-photos-section") as HTMLElement;
const statuses = (container: HTMLElement) => Array.from(container.querySelectorAll(".post-photo-status")).map((item) => item.textContent);
const srcs = (container: HTMLElement) => Array.from(container.querySelectorAll("img")).map((img) => img.getAttribute("src")?.split("/").pop());
const link = (container: HTMLElement, label: string) => Array.from(container.querySelectorAll("a")).find((item) => item.textContent === label);
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
async function choose(container: HTMLElement, mocks: Mocks, ...numbers: number[]) {
  mocks.offer(...numbers);
  await click(button(container, "Agregar fotos"));
}
const key = (n: number) => `trips/${tripId}/photos/k${n}`;
const newActivityBody = { title: "Cena", scheduledAt: "2026-09-25T15:00:00.000Z", durationMinutes: 90 };
async function addActivity(container: HTMLElement) {
  await click(button(container, "Vincular a")); await click(Array.from(container.querySelectorAll("label")).find((item) => item.textContent?.trim().startsWith("Actividad"))?.querySelector("input") ?? undefined);
  await click(button(container, "Crear actividad espontánea"));
  await field(container, "title", "Cena"); await field(container, "date", "2026-09-25"); await field(container, "time", "12:00");
  await field(container, "durationHours", "1"); await field(container, "durationMinutes", "30");
  await click(button(container, "Aceptar"));
}

describe("PostComposer photos: selection", () => {
  it("shows no photo section without the optional dependency", async () => {
    const { container } = await render(newPath, undefined);
    expect(container.querySelector(".post-photos-section")).toBeNull();
    expect(button(container, "Agregar fotos")).toBeUndefined();
  });
  it("selects from the gallery and the camera, keeps the order and names each thumbnail", async () => {
    const mocks = makeDeps();
    const { container } = await render(newPath, mocks);
    await choose(container, mocks, 1, 2);
    expect(mocks.source.select).toHaveBeenLastCalledWith("gallery");
    mocks.offer(3); await click(button(container, "Sacar foto"));
    expect(mocks.source.select).toHaveBeenLastCalledWith("camera");
    expect(srcs(container)).toEqual(["1.jpg", "2.jpg", "3.jpg"]);
    expect(Array.from(container.querySelectorAll("img")).map((img) => img.alt)).toEqual(["Foto 1 de 3", "Foto 2 de 3", "Foto 3 de 3"]);
    expect(statuses(container)).toEqual(["Lista", "Lista", "Lista"]);
    expect(mocks.api.reserve).not.toHaveBeenCalled(); expect(mocks.transfer.put).not.toHaveBeenCalled();
  });
  it("reorders without dragging and removes a photo", async () => {
    const mocks = makeDeps();
    const { container } = await render(newPath, mocks);
    await choose(container, mocks, 1, 2, 3);
    await click(button(container, "Subir foto 3 de 3"));
    expect(srcs(container)).toEqual(["1.jpg", "3.jpg", "2.jpg"]);
    await click(button(container, "Quitar foto 1 de 3"));
    expect(srcs(container)).toEqual(["3.jpg", "2.jpg"]);
  });
  it("names the photo whose conversion failed, adds the others and never publishes the failed one", async () => {
    const mocks = makeDeps();
    mocks.reader.read.mockImplementationOnce(async (photo: { reference: string }) => ok(new Blob([photo.reference], { type: "image/jpeg" })))
      .mockResolvedValueOnce(err(new PhotoReadError("convert")) as never);
    const { container, create } = await render(newPath, mocks);
    await choose(container, mocks, 1, 2, 3);
    expect(srcs(container)).toEqual(["1.jpg", "3.jpg"]);
    const text = section(container).querySelector('[role="alert"]')?.textContent ?? "";
    expect(text).toContain("2.ª foto elegida");
    expect(text).toContain("No se agregó");
    expect(text).toContain("No pudimos convertir o reducir esta foto");
    await submit(container);
    expect(mocks.api.reserve).toHaveBeenCalledExactlyOnceWith(tripId, [{ contentType: "image/jpeg", sizeBytes: 13 }, { contentType: "image/jpeg", sizeBytes: 13 }]);
    expect(mocks.transfer.put).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { photos: [{ key: key(1) }, { key: key(2) }] });
  });
  it("shows an alert and no list when every photo fails", async () => {
    const mocks = makeDeps();
    mocks.reader.read.mockResolvedValue(err(new PhotoReadError("convert")) as never);
    const { container } = await render(newPath, mocks);
    await choose(container, mocks, 1, 2);
    expect(container.querySelector("ul")).toBeNull();
    const text = section(container).querySelector('[role="alert"]')?.textContent ?? "";
    expect(text).toContain("1.ª foto elegida"); expect(text).toContain("2.ª foto elegida");
  });
  it("shows «Preparando fotos…» while the reader is pending", async () => {
    const mocks = makeDeps();
    const gate = deferred<unknown>();
    mocks.reader.read.mockImplementationOnce(() => gate.promise as never);
    const { container } = await render(newPath, mocks);
    await choose(container, mocks, 1);
    expect(section(container).querySelector('[role="status"]')?.textContent).toBe("Preparando fotos…");
    await act(async () => gate.resolve(ok(new Blob(["x"], { type: "image/jpeg" }))));
    expect(section(container).querySelector('[role="status"]')?.textContent).toBe("");
    expect(srcs(container)).toEqual(["1.jpg"]);
  });
  it("stops at 10 photos with a message", async () => {
    const mocks = makeDeps();
    const { container } = await render(newPath, mocks);
    await choose(container, mocks, 1, 2, 3, 4, 5, 6, 7, 8);
    await choose(container, mocks, 9, 10, 11, 12);
    expect(container.querySelectorAll("li[data-photo]")).toHaveLength(10);
    expect(section(container).querySelector('[role="alert"]')?.textContent).toContain("10 fotos");
  });
  it("a cancelled picker is silent and returns the focus to the button that opened it", async () => {
    const mocks = makeDeps();
    const { container } = await render(newPath, mocks);
    mocks.offerError("cancelled");
    await click(button(container, "Sacar foto"));
    expect(alerts(container)).toHaveLength(0);
    expect(document.activeElement).toBe(button(container, "Sacar foto"));
  });
  it("explains a denied camera and keeps the gallery usable", async () => {
    const mocks = makeDeps();
    const { container } = await render(newPath, mocks);
    mocks.offerError("denied");
    await click(button(container, "Sacar foto"));
    expect(section(container).querySelector('[role="alert"]')?.textContent).toBe("No tenemos permiso para la cámara. Habilitalo en Ajustes o elegí fotos de la galería.");
    await choose(container, mocks, 1);
    expect(srcs(container)).toEqual(["1.jpg"]);
    expect(section(container).querySelector('[role="alert"]')).toBeNull();
  });
  it("tells unsupported platforms and native failures apart", async () => {
    const mocks = makeDeps();
    const { container } = await render(newPath, mocks);
    mocks.offerError("unsupported"); await click(button(container, "Agregar fotos"));
    expect(section(container).querySelector('[role="alert"]')?.textContent).toBe("Disponible solo en la app.");
    mocks.offerError("native"); await click(button(container, "Agregar fotos"));
    expect(section(container).querySelector('[role="alert"]')?.textContent).toContain("No pudimos abrir las fotos");
    expect(alerts(container)).toHaveLength(1);
  });
});

describe("PostComposer photos: publishing", () => {
  it("reserves once, uploads straight to the signed urls, then creates with the keys in order and clears the draft", async () => {
    const log: Log = [], mocks = makeDeps(log);
    const create = vi.fn().mockImplementation(async () => { log.push("create"); return { ok: true, value: saved() }; });
    const { container } = await render(newPath, mocks, { create });
    await field(container, "description", "Atardecer"); await choose(container, mocks, 1, 2);
    await click(button(container, "Subir foto 2 de 2"));
    await submit(container);
    expect(mocks.api.reserve).toHaveBeenCalledExactlyOnceWith(tripId, [{ contentType: "image/jpeg", sizeBytes: 13 }, { contentType: "image/jpeg", sizeBytes: 13 }]);
    expect(log.filter((entry) => entry.startsWith("put"))).toHaveLength(2);
    expect(log[0]).toBe("reserve:2"); expect(log[log.length - 1]).toBe("create");
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Atardecer", photos: [{ key: key(1) }, { key: key(2) }] });
    expect(container.querySelector('[data-testid="listing"]')).not.toBeNull();
    await click(link(container, "nav-new"));
    expect(value(container, "description")).toBe(""); expect(container.querySelector("li[data-photo]")).toBeNull();
  });
  it("sends the exact photo order the person arranged", async () => {
    const mocks = makeDeps();
    const { container, create } = await render(newPath, mocks);
    await choose(container, mocks, 1, 2, 3);
    await click(button(container, "Bajar foto 1 de 3"));
    await submit(container);
    const sent = (create.mock.calls[0]![1] as { photos: { key: string }[] }).photos;
    expect(sent).toHaveLength(3);
    // Keys follow the draft order: the first key travels with the blob of the photo that is now first (the one selected second).
    const blobs = await Promise.all(mocks.reader.read.mock.results.map((result) => result.value as Promise<{ value: Blob }>)).then((all) => all.map((item) => item.value));
    const blobSentTo = (index: number) => (mocks.transfer.put.mock.calls.find((call) => (call as unknown as [string])[0].endsWith(`k${index}`)) as unknown as [string, unknown, Blob])[2];
    expect(blobSentTo(1)).toBe(blobs[1]); expect(blobSentTo(2)).toBe(blobs[0]); expect(blobSentTo(3)).toBe(blobs[2]);
    expect(sent.map((item) => item.key)).toEqual([key(1), key(2), key(3)]);
  });
  it("publishes a memory made only of photos", async () => {
    const mocks = makeDeps();
    const { container, create } = await render(newPath, mocks);
    await choose(container, mocks, 1); await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { photos: [{ key: key(1) }] });
  });
  it("with a failed photo sends neither POST nor PATCH, keeps text, link and form, and says what to do", async () => {
    const mocks = makeDeps();
    mocks.transfer.put.mockImplementation(async (url: string) => url.endsWith("k2") ? { ok: false, code: "network" } as const : { ok: true } as const);
    const { container, create } = await render(`${newPath}?transportId=${transportId}`, mocks);
    await field(container, "description", "Atardecer"); await field(container, "mapsUrl", "https://maps.example/x"); await choose(container, mocks, 1, 2, 3);
    await submit(container);
    expect(create).not.toHaveBeenCalled();
    expect(statuses(container)).toEqual(["Lista", "No se subió. Sin conexión.", "Lista"]);
    expect(alerts(container)).toHaveLength(1);
    expect(alerts(container)[0]!.textContent).toContain("Una foto no se subió");
    expect(alerts(container)[0]!.textContent).toContain("El recuerdo no se publicó");
    expect(value(container, "description")).toBe("Atardecer"); expect(value(container, "mapsUrl")).toBe("https://maps.example/x");
    expect(container.textContent).toContain("Vinculado a un transporte");
    expect((container.querySelector('[name="description"]') as HTMLTextAreaElement).disabled).toBe(false);
    expect(document.activeElement).toBe(button(container, "Reintentar foto 2 de 3"));
    expect(container.querySelector('[data-testid="listing"]')).toBeNull();
  });
  it("retrying one photo reserves a single new key and uploads it without touching the post, then publishes once with every key", async () => {
    const mocks = makeDeps();
    mocks.transfer.put.mockImplementationOnce(async () => ({ ok: true } as const)).mockImplementationOnce(async () => ({ ok: false, code: "network" } as const));
    const { container, create } = await render(newPath, mocks);
    await field(container, "description", "Hola"); await choose(container, mocks, 1, 2);
    await submit(container);
    expect(create).not.toHaveBeenCalled();
    await click(button(container, "Reintentar foto 2 de 2"));
    expect(mocks.api.reserve).toHaveBeenCalledTimes(2);
    expect(mocks.api.reserve).toHaveBeenLastCalledWith(tripId, [{ contentType: "image/jpeg", sizeBytes: 13 }]);
    expect(mocks.transfer.put).toHaveBeenCalledTimes(3);
    expect(create).not.toHaveBeenCalled();
    expect(statuses(container)).toEqual(["Lista", "Lista"]);
    expect(alerts(container)).toHaveLength(0);
    await submit(container);
    expect(mocks.api.reserve).toHaveBeenCalledTimes(2); expect(mocks.transfer.put).toHaveBeenCalledTimes(3);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Hola", photos: [{ key: key(1) }, { key: key(3) }] });
  });
  it("resends the very same input after the agenda confirmation without uploading or reserving again", async () => {
    const mocks = makeDeps();
    const confirmation = { confirmedConflicts: [{ activityId: itineraryId(8), reason: "overlap" as const, scheduledAt: "2026-09-25T14:30:00.000Z", durationMinutes: 60 }],
      confirmedActivity: { scheduledAt: "2026-09-25T15:00:00.000Z", durationMinutes: 90 } };
    const activity = { id: itineraryId(60), tripId, dayId: itineraryId(4), title: "Cena", description: null, mapsUrl: null, scheduledAt: "2026-09-25T15:00:00.000Z", durationMinutes: 90,
      createdAt: "2026-09-25T10:00:00.123Z", createdBy: itineraryId(20) };
    const participation = { id: itineraryId(61), tripId, activityId: itineraryId(60), userId: itineraryId(20), status: "going", updatedAt: "2026-09-25T12:00:00.123Z" };
    const create = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "participation-conflict", confirmation } })
      .mockResolvedValueOnce({ ok: true, value: { ...saved(), activity, participation } });
    const { container } = await render(newPath, mocks, { create });
    await field(container, "description", "Hola"); await choose(container, mocks, 1); await addActivity(container);
    await submit(container);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![1]).toEqual({ description: "Hola", newActivity: newActivityBody, photos: [{ key: key(1) }] });
    expect(mocks.api.reserve).toHaveBeenCalledTimes(1); expect(mocks.transfer.put).toHaveBeenCalledTimes(1);
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    await click(button(dialog, "Cambiar de plan"));
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]![1]).toEqual(create.mock.calls[0]![1]);
    expect(create.mock.calls[1]![2]).toEqual(confirmation);
    expect(mocks.api.reserve).toHaveBeenCalledTimes(1); expect(mocks.transfer.put).toHaveBeenCalledTimes(1);
  });
  it("marks the photo named by a 422 and uploads it again on the next attempt without a second create on the old key", async () => {
    const mocks = makeDeps();
    const create = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "validation", fields: [{ field: "photos[1].key", code: "not_uploaded", message: "x" }] } })
      .mockResolvedValueOnce({ ok: true, value: saved() });
    const { container } = await render(newPath, mocks, { create });
    await field(container, "description", "Hola"); await choose(container, mocks, 1, 2);
    await submit(container);
    expect(statuses(container)).toEqual(["Lista", "No se subió. No llegó al servidor."]);
    expect(alerts(container)).toHaveLength(1);
    expect(document.activeElement).toBe(button(container, "Reintentar foto 2 de 2"));
    await submit(container);
    expect(mocks.api.reserve).toHaveBeenLastCalledWith(tripId, [{ contentType: "image/jpeg", sizeBytes: 13 }]);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]![1]).toEqual({ description: "Hola", photos: [{ key: key(1) }, { key: key(3) }] });
  });
  it("shows a general message for a 422 about the number of photos without marking any", async () => {
    const mocks = makeDeps();
    const create = vi.fn().mockResolvedValue({ ok: false, error: { kind: "validation", fields: [{ field: "photos", code: "too_many", message: "x" }] } });
    const { container } = await render(newPath, mocks, { create });
    await field(container, "description", "Hola"); await choose(container, mocks, 1);
    await submit(container);
    expect(statuses(container)).toEqual(["Lista"]);
    expect(alerts(container)).toHaveLength(1);
    expect(alerts(container)[0]!.textContent).toContain("fotos");
    expect(value(container, "description")).toBe("Hola");
  });
  it("on a photo conflict tells to review the memories, links to the list, keeps the draft and retries with the same keys", async () => {
    const mocks = makeDeps();
    const create = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "server", code: "PhotoConflictError" } })
      .mockResolvedValueOnce({ ok: false, error: { kind: "network" } });
    const { container } = await render(newPath, mocks, { create });
    await field(container, "description", "Hola"); await choose(container, mocks, 1);
    await submit(container);
    expect(alerts(container)).toHaveLength(1);
    expect(alerts(container)[0]!.textContent).toContain("Revisá tus recuerdos antes de reintentar; puede que ya esté publicado");
    expect(alerts(container)[0]!.querySelector("a")?.getAttribute("href")).toBe(`/trips/${tripId}/memories`);
    expect(value(container, "description")).toBe("Hola"); expect(srcs(container)).toEqual(["1.jpg"]);
    await submit(container);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]![1]).toEqual(create.mock.calls[0]![1]);
    expect(mocks.api.reserve).toHaveBeenCalledTimes(1);
    expect(alerts(container)[0]!.textContent).toContain("Podés reintentar: el recuerdo no se va a publicar dos veces.");
  });
  it.each([["not-found"], ["forbidden"]])("after a %s on create shows the text read-only and copyable and keeps the draft", async (kind) => {
    const mocks = makeDeps();
    const create = vi.fn().mockResolvedValue({ ok: false, error: { kind } });
    const { container } = await render(newPath, mocks, { create });
    await field(container, "description", "Mi texto largo"); await choose(container, mocks, 1);
    await submit(container);
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("Tu recuerdo no se publicó");
    const readOnly = container.querySelector('textarea[readonly]') as HTMLTextAreaElement;
    expect(readOnly.value).toBe("Mi texto largo");
    await click(link(container, "nav-edit")); await click(link(container, "nav-new"));
    expect(value(container, "description")).toBe("Mi texto largo");
    expect(create).toHaveBeenCalledTimes(1);
  });
  it("a 404 while reserving in creation says the memory was not published and keeps the text copyable", async () => {
    const mocks = makeDeps();
    mocks.api.reserve.mockResolvedValueOnce({ ok: false, error: { kind: "not-found" } } as never);
    const { container } = await render(newPath, mocks);
    await field(container, "description", "Texto"); await choose(container, mocks, 1);
    await submit(container);
    expect(container.textContent).toContain("Tu recuerdo no se publicó. Copiá tu texto antes de salir.");
    expect(container.textContent).not.toContain("Ya no podés editar este recuerdo");
    expect((container.querySelector("textarea[readonly]") as HTMLTextAreaElement).value).toBe("Texto");
  });
  it("a 404 while reserving in an edit says the memory can no longer be edited, not that it was not published, and keeps the text copyable", async () => {
    const mocks = makeDeps();
    mocks.api.reserve.mockResolvedValueOnce({ ok: false, error: { kind: "not-found" } } as never);
    const { container } = await render(editPath, mocks);
    await choose(container, mocks, 1); await field(container, "description", "Texto editado");
    await submit(container);
    expect(container.textContent).toContain("Ya no podés editar este recuerdo. Tu texto sigue acá para que lo copies.");
    expect(container.textContent).not.toContain("no se publicó");
    expect((container.querySelector("textarea[readonly]") as HTMLTextAreaElement).value).toBe("Texto editado");
  });
  it("a 404 while reserving blocks the form without clearing the draft or calling create", async () => {
    const mocks = makeDeps();
    mocks.api.reserve.mockResolvedValueOnce({ ok: false, error: { kind: "not-found" } } as never);
    const { container, create } = await render(newPath, mocks);
    await field(container, "description", "Texto"); await choose(container, mocks, 1);
    await submit(container);
    expect(create).not.toHaveBeenCalled(); expect(mocks.transfer.put).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Este recuerdo ya no está disponible");
    expect((container.querySelector("textarea[readonly]") as HTMLTextAreaElement).value).toBe("Texto");
  });
  it("a 401 while reserving asks to sign in again, uploads nothing and keeps the draft", async () => {
    const mocks = makeDeps();
    mocks.api.reserve.mockResolvedValueOnce({ ok: false, error: { kind: "unauthorized" } } as never);
    const { container, create } = await render(newPath, mocks);
    await field(container, "description", "Texto"); await choose(container, mocks, 1);
    await submit(container);
    expect(container.textContent).toContain("Tu sesión venció");
    expect(link(container, "Iniciar sesión")?.getAttribute("href")).toBe("/login");
    expect(create).not.toHaveBeenCalled(); expect(mocks.transfer.put).not.toHaveBeenCalled();
  });
  it("a reservation failure other than revocation reports it and sends nothing", async () => {
    const mocks = makeDeps();
    mocks.api.reserve.mockResolvedValueOnce({ ok: false, error: { kind: "network" } } as never);
    const { container, create } = await render(newPath, mocks);
    await field(container, "description", "Texto"); await choose(container, mocks, 1);
    await submit(container);
    expect(create).not.toHaveBeenCalled();
    expect(alerts(container)).toHaveLength(1);
    expect(alerts(container)[0]!.textContent).toContain("No pudimos subir las fotos");
    expect(container.querySelector("form")).not.toBeNull();
  });
  it("a 422 on the reservation marks the named photo of the batch and points to it instead of blaming the connection", async () => {
    const mocks = makeDeps();
    mocks.api.reserve.mockResolvedValueOnce({ ok: false, error: { kind: "validation", fields: [{ field: "files[1].contentType", code: "unsupported", message: "x" }] } } as never);
    const { container, create } = await render(newPath, mocks);
    await field(container, "description", "Texto"); await choose(container, mocks, 1, 2, 3);
    await submit(container);
    expect(create).not.toHaveBeenCalled(); expect(mocks.transfer.put).not.toHaveBeenCalled();
    expect(statuses(container)[0]).toBe("Lista"); expect(statuses(container)[2]).toBe("Lista");
    expect(statuses(container)[1]).not.toBe("Lista");
    expect(alerts(container)).toHaveLength(1);
    expect(alerts(container)[0]!.textContent).toContain("Alguna foto no es válida. Revisá las fotos marcadas, quitalas o reemplazalas.");
    expect(alerts(container)[0]!.textContent).not.toContain("conexión");
    expect(value(container, "description")).toBe("Texto");
  });
  it("a 422 on the reservation maps files[i] to the photo of the batch, not to the position in the current draft", async () => {
    const mocks = makeDeps();
    // Photo 1 ends up uploaded (the create fails), so the next batch holds photos 2 and 3: files[0] is photo 2, which is position 1 of the draft.
    const create = vi.fn().mockResolvedValue({ ok: false, error: { kind: "network" } });
    const { container } = await render(newPath, mocks, { create });
    await field(container, "description", "Texto"); await choose(container, mocks, 1);
    await submit(container);
    await choose(container, mocks, 2, 3);
    const before = statuses(container);
    mocks.api.reserve.mockResolvedValueOnce({ ok: false, error: { kind: "validation", fields: [{ field: "files[0].sizeBytes", code: "too_large", message: "x" }] } } as never);
    await submit(container);
    const after = statuses(container);
    expect(after[0]).toBe(before[0]); expect(after[2]).toBe(before[2]);
    expect(after[1]).not.toBe(before[1]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(alerts(container)).toHaveLength(1);
    expect(alerts(container)[0]!.textContent).toContain("Alguna foto no es válida");
  });
  it("a network failure on the reservation keeps the connection message", async () => {
    const mocks = makeDeps();
    mocks.api.reserve.mockResolvedValueOnce({ ok: false, error: { kind: "network" } } as never);
    const { container } = await render(newPath, mocks);
    await field(container, "description", "Texto"); await choose(container, mocks, 1, 2);
    await submit(container);
    expect(alerts(container)).toHaveLength(1);
    expect(alerts(container)[0]!.textContent).toContain("Revisá tu conexión");
    expect(alerts(container)[0]!.textContent).not.toContain("no es válida");
  });
  it("on a network failure after uploading, the retry hint appears and the retry reuses the same keys", async () => {
    const mocks = makeDeps();
    const create = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "network" } }).mockResolvedValueOnce({ ok: true, value: saved() });
    const { container } = await render(newPath, mocks, { create });
    await field(container, "description", "Hola"); await choose(container, mocks, 1);
    await submit(container);
    expect(container.textContent).toContain("Podés reintentar: el recuerdo no se va a publicar dos veces.");
    await submit(container);
    expect(create.mock.calls[1]![1]).toEqual(create.mock.calls[0]![1]);
    expect(mocks.api.reserve).toHaveBeenCalledTimes(1); expect(mocks.transfer.put).toHaveBeenCalledTimes(1);
  });
});

describe("PostComposer photos: editing", () => {
  it("uploads first and then sends a PATCH that only adds the photos", async () => {
    const log: Log = [], mocks = makeDeps(log);
    const update = vi.fn().mockImplementation(async () => { log.push("update"); return { ok: true, value: saved() }; });
    const { container } = await render(editPath, mocks, { update });
    await choose(container, mocks, 1, 2);
    await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, { photos: [{ key: key(1) }, { key: key(2) }] });
    expect(log[0]).toBe("reserve:2"); expect(log[log.length - 1]).toBe("update");
    expect(container.querySelector('[data-testid="listing"]')).not.toBeNull();
  });
  it("when an upload fails the PATCH is not sent and the message says the memory did not change", async () => {
    const mocks = makeDeps();
    mocks.transfer.put.mockResolvedValue({ ok: false, code: "network" });
    const { container, update } = await render(editPath, mocks);
    await field(container, "description", "Nuevo texto"); await choose(container, mocks, 1);
    await submit(container);
    expect(update).not.toHaveBeenCalled();
    expect(alerts(container)).toHaveLength(1);
    expect(alerts(container)[0]!.textContent).toContain("El recuerdo no cambió");
    expect(value(container, "description")).toBe("Nuevo texto");
  });
  it("still says there is nothing to save when nothing changed and no photo was added", async () => {
    const mocks = makeDeps();
    const { container, update } = await render(editPath, mocks);
    await submit(container);
    expect(update).not.toHaveBeenCalled();
    expect(container.textContent).toContain("No hay cambios para guardar.");
    expect(mocks.api.reserve).not.toHaveBeenCalled();
  });
});

describe("PostComposer photos: busy and unmount", () => {
  it("shows one polite status with the count and per-photo progress while uploading, and keeps the focus on a pressed control", async () => {
    const mocks = makeDeps();
    const gate = deferred<UploadOutcome>();
    let onProgress: ((fraction: number) => void) | undefined;
    mocks.transfer.put.mockImplementation((async (url: string, _h: unknown, _b: Blob, options: { onProgress?: (fraction: number) => void }) => {
      if (url.endsWith("k1")) { onProgress = options.onProgress; return gate.promise; }
      return { ok: true };
    }) as never);
    const { container } = await render(newPath, mocks);
    await field(container, "description", "Hola"); await choose(container, mocks, 1, 2);
    await submit(container);
    expect(section(container).querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(section(container).querySelector('[role="status"]')?.textContent).toBe("Subiendo fotos: 1 de 2");
    await act(async () => onProgress!(0.47));
    expect(statuses(container)[0]).toBe("Subiendo 45 %");
    const add = button(container, "Agregar fotos")!;
    add.focus();
    expect(add.getAttribute("aria-disabled")).toBe("true");
    expect(add.disabled).toBe(false);
    await click(add);
    expect(document.activeElement).toBe(add);
    expect(mocks.source.select).toHaveBeenCalledTimes(1);
    expect(alerts(container)).toHaveLength(0);
    await act(async () => gate.resolve({ ok: true }));
  });
  it("aborts the transfers when the screen unmounts and keeps the photos already uploaded for the next try", async () => {
    const mocks = makeDeps();
    let signal: AbortSignal | undefined;
    mocks.transfer.put.mockImplementation((async (url: string, _h: unknown, _b: Blob, options: { signal?: AbortSignal }) => {
      if (url.endsWith("k1")) return { ok: true };
      signal = options.signal;
      return new Promise((resolve) => options.signal?.addEventListener("abort", () => resolve({ ok: false, code: "aborted" })));
    }) as never);
    const { container, create } = await render(newPath, mocks);
    await field(container, "description", "Hola"); await choose(container, mocks, 1, 2);
    await submit(container);
    expect(signal?.aborted).toBe(false);
    await click(link(container, "nav-edit"));
    expect(signal?.aborted).toBe(true);
    expect(create).not.toHaveBeenCalled();
    await click(link(container, "nav-new"));
    expect(srcs(container)).toEqual(["1.jpg", "2.jpg"]);
    mocks.transfer.put.mockImplementation((async () => ({ ok: true })) as never);
    await submit(container);
    expect(mocks.api.reserve).toHaveBeenLastCalledWith(tripId, [{ contentType: "image/jpeg", sizeBytes: 13 }]);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("PostComposer photos: minimum content", () => {
  const withPost = (extra: Partial<PostResponse>) => vi.fn().mockResolvedValue({ ok: true, value: { post: saved(extra), parent: null, children: [], rootActivityId: null } });
  const counting = (mocks: Mocks, impl: (...args: unknown[]) => unknown) => { const countForPost = vi.fn(impl); Object.assign(mocks.api, { countForPost }); return countForPost; };
  const missing = "Escribí un texto, agregá una ubicación o elegí una foto.";
  it("creates with only a photo: sends the key and no description", async () => {
    const mocks = makeDeps();
    const { container, create } = await render(newPath, mocks);
    await choose(container, mocks, 1); await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { photos: [{ key: key(1) }] });
  });
  it("creating with nothing shows the single content message and does not call the API", async () => {
    const mocks = makeDeps();
    const { container, create } = await render(newPath, mocks);
    await submit(container);
    expect(create).not.toHaveBeenCalled();
    expect(alerts(container).map((item) => item.textContent)).toEqual([missing]);
    expect(document.activeElement).toBe(container.querySelector('[name="description"]'));
    expect(mocks.api.reserve).not.toHaveBeenCalled();
  });
  it("editing: removing the text counts the published photos and sends the clear", async () => {
    const mocks = makeDeps(), count = counting(mocks, async () => ({ ok: true, value: 2 }));
    const { container, update } = await render(editPath, mocks);
    await field(container, "description", ""); await submit(container);
    expect(count).toHaveBeenCalledExactlyOnceWith(tripId, postId);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, { description: null });
    expect(alerts(container)).toHaveLength(0);
  });
  it("editing without published photos blocks, keeps the draft and sends nothing; typing again saves", async () => {
    const mocks = makeDeps(), count = counting(mocks, async () => ({ ok: true, value: 0 }));
    const { container, update } = await render(editPath, mocks);
    await field(container, "description", ""); await submit(container);
    expect(count).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    expect(alerts(container).map((item) => item.textContent)).toEqual([missing]);
    expect(document.activeElement).toBe(container.querySelector('[name="description"]'));
    expect(value(container, "description")).toBe("");
    await field(container, "description", "Nuevo"); await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, { description: "Nuevo" });
  });
  it("a failed or rejected count does not block: the server decides and its 422 description/required shows on the field", async () => {
    const mocks = makeDeps(), count = counting(mocks, async () => { throw new Error("down"); });
    const update = vi.fn().mockResolvedValue({ ok: false, error: { kind: "validation", fields: [{ field: "description", code: "required", message: "x" }] } });
    const { container } = await render(editPath, mocks, { update });
    await field(container, "description", ""); await submit(container);
    expect(count).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, { description: null });
    expect(alerts(container).map((item) => item.textContent)).toEqual([missing]);
    expect(document.activeElement).toBe(container.querySelector('[name="description"]'));
  });
  it("a count that answers with an error result also continues", async () => {
    const mocks = makeDeps(); counting(mocks, async () => ({ ok: false, error: { kind: "network" } }));
    const { container, update } = await render(editPath, mocks);
    await field(container, "description", ""); await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, { description: null });
  });
  it("removing the text while keeping the location does not query the photos", async () => {
    const mocks = makeDeps(), count = counting(mocks, async () => ({ ok: true, value: 0 }));
    const { container, update } = await render(editPath, mocks, { get: withPost({ mapsUrl: "https://maps.example/x" }) });
    await field(container, "description", ""); await submit(container);
    expect(count).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, { description: null });
  });
  it("saving without touching text or location neither queries nor blocks", async () => {
    const mocks = makeDeps(), count = counting(mocks, async () => ({ ok: true, value: 0 }));
    const { container, update } = await render(editPath, mocks, { get: withPost({ description: null, mapsUrl: null }) });
    await submit(container);
    expect(count).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
    expect(container.textContent).toContain("No hay cambios para guardar.");
    expect(alerts(container)).toHaveLength(0);
  });
  it("a new photo makes the edit valid without querying", async () => {
    const mocks = makeDeps(), count = counting(mocks, async () => ({ ok: true, value: 0 }));
    const { container, update } = await render(editPath, mocks);
    await field(container, "description", ""); await choose(container, mocks, 1); await submit(container);
    expect(count).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, { description: null, photos: [{ key: key(1) }] });
  });
  it("a second tap during the query does not query or send twice", async () => {
    const mocks = makeDeps(), gate = deferred<unknown>(), count = counting(mocks, () => gate.promise);
    const { container, update } = await render(editPath, mocks);
    await field(container, "description", ""); await submit(container); await submit(container);
    expect(count).toHaveBeenCalledTimes(1);
    await act(async () => gate.resolve({ ok: true, value: 1 }));
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe("PostComposer published photos (T128)", () => {
  const P1 = itineraryId(81), P2 = itineraryId(82);
  const publishedList = [{ id: P1, order: 1, url: "https://cdn.test/p1.jpg?sig=x" }, { id: P2, order: 2 }];
  const withList = (mocks: Mocks, impl: (...args: unknown[]) => unknown = async () => ({ ok: true, value: publishedList })) => {
    const listForPost = vi.fn(impl); Object.assign(mocks.api, { listForPost }); return listForPost;
  };
  const rows = (container: HTMLElement) => Array.from(container.querySelectorAll("[data-published-photo]")) as HTMLElement[];
  const rowAction = (container: HTMLElement, id: string) => container.querySelector(`[data-published-photo="${id}"] button`) as HTMLButtonElement;
  const withPost = (extra: Partial<PostResponse>) => vi.fn().mockResolvedValue({ ok: true, value: { post: saved(extra), parent: null, children: [], rootActivityId: null } });
  const missing = "Escribí un texto, agregá una ubicación o elegí una foto.";
  const author = itineraryId(20), other = itineraryId(21);
  const membersFor = (currentUserId: string) => ({ list: vi.fn().mockResolvedValue({ ok: true, value: { currentUserId, members: [
    { id: itineraryId(100), userId: author, name: "Ana", role: "participant", joinedAt: "2026-01-01T00:00:00.000Z" },
    { id: itineraryId(101), userId: other, name: "Beto", role: "participant", joinedAt: "2026-01-01T00:00:00.000Z" }] } }) });
  it("lists the published photos when editing, and asks for them only when editing", async () => {
    const mocks = makeDeps(), list = withList(mocks);
    const { container } = await render(editPath, mocks);
    expect(list).toHaveBeenCalledExactlyOnceWith(tripId, postId);
    expect(rows(container)).toHaveLength(2);
    expect(rows(container)[0]!.querySelector("img")?.getAttribute("src")).toBe("https://cdn.test/p1.jpg?sig=x");
    const created = makeDeps(), createList = withList(created);
    await render(newPath, created);
    expect(createList).not.toHaveBeenCalled();
  });
  it("shows the published photos above the section to add new ones", async () => {
    const mocks = makeDeps(); withList(mocks);
    const { container } = await render(editPath, mocks);
    const published = container.querySelector("[data-published-photos]")!;
    const adding = container.querySelector("#post-photos-heading")!.closest("section")!;
    expect(published.compareDocumentPosition(adding) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("removing one and saving sends removePhotos with its id only", async () => {
    const mocks = makeDeps(); withList(mocks);
    const { container, update } = await render(editPath, mocks);
    await click(rowAction(container, P2));
    expect(container.querySelector(`[data-published-photo="${P2}"]`)!.textContent).toContain("Se quitará al guardar");
    await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, { removePhotos: [{ id: P2 }] });
    expect(container.querySelector('[data-testid="listing"]')?.textContent).toContain("updated");
  });
  it("undoing the removal sends nothing", async () => {
    const mocks = makeDeps(); withList(mocks);
    const { container, update } = await render(editPath, mocks);
    await click(rowAction(container, P1)); await click(rowAction(container, P1));
    await submit(container);
    expect(update).not.toHaveBeenCalled();
    expect(container.textContent).toContain("No hay cambios para guardar.");
  });
  it("combines the removal with new photos and text in one PATCH", async () => {
    const mocks = makeDeps(); withList(mocks);
    const { container, update } = await render(editPath, mocks);
    await field(container, "description", "Otro"); await click(rowAction(container, P1)); await choose(container, mocks, 1);
    await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, { description: "Otro", photos: [{ key: key(1) }], removePhotos: [{ id: P1 }] });
  });
  it("a pending removal counts as a change: Cancelar asks before discarding", async () => {
    const mocks = makeDeps(); withList(mocks);
    const { container } = await render(editPath, mocks);
    await click(rowAction(container, P2));
    await click(button(container, "Cancelar"));
    expect(document.body.textContent).toContain("Descartar cambios");
  });
  it("removing the last photo without text or location shows the content message without asking the network", async () => {
    const mocks = makeDeps(), count = vi.fn(); Object.assign(mocks.api, { countForPost: count });
    withList(mocks, async () => ({ ok: true, value: [publishedList[0]] }));
    const { container, update } = await render(editPath, mocks, { get: withPost({ description: null, mapsUrl: null }) });
    await click(rowAction(container, P1));
    await submit(container);
    expect(update).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
    expect(alerts(container).map((item) => item.textContent)).toEqual([missing]);
    expect(rows(container)).toHaveLength(1);
  });
  it("removing all the photos is allowed with text, or with a new photo", async () => {
    const mocks = makeDeps(); withList(mocks, async () => ({ ok: true, value: [publishedList[0]] }));
    const { container, update } = await render(editPath, mocks, { get: withPost({ description: null, mapsUrl: null }) });
    await click(rowAction(container, P1)); await choose(container, mocks, 1);
    await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, { photos: [{ key: key(1) }], removePhotos: [{ id: P1 }] });
  });
  it("removing a photo while others remain does not need text", async () => {
    const mocks = makeDeps(); withList(mocks);
    const { container, update } = await render(editPath, mocks, { get: withPost({ description: null, mapsUrl: null }) });
    await click(rowAction(container, P1));
    await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, { removePhotos: [{ id: P1 }] });
  });
  it("falls back to counting the published photos when the list could not be loaded, and does not block saving", async () => {
    const mocks = makeDeps(), count = vi.fn(async () => ({ ok: true as const, value: 0 })); Object.assign(mocks.api, { countForPost: count });
    withList(mocks, async () => ({ ok: false, error: { kind: "network" } }));
    const { container, update } = await render(editPath, mocks);
    expect(container.textContent).toContain("No pudimos cargar las fotos publicadas");
    expect(rows(container)).toHaveLength(0);
    await field(container, "description", ""); await submit(container);
    expect(count).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    expect(alerts(container).map((item) => item.textContent)).toContain(missing);
    await field(container, "description", "Nuevo"); await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, { description: "Nuevo" });
  });
  it("retries the list from the failure message", async () => {
    const mocks = makeDeps();
    const list = withList(mocks, vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "server" } }).mockResolvedValue({ ok: true, value: publishedList }));
    const { container } = await render(editPath, mocks);
    await click(button(container, "Reintentar fotos publicadas"));
    expect(list).toHaveBeenCalledTimes(2);
    expect(rows(container)).toHaveLength(2);
    expect(container.textContent).not.toContain("No pudimos cargar las fotos publicadas");
  });
  it("a 422 not_in_post explains it, reloads the list and keeps the draft", async () => {
    const mocks = makeDeps(), list = withList(mocks);
    const update = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "validation", fields: [{ field: "removePhotos[0].id", code: "not_in_post", message: "x" }] } })
      .mockResolvedValue({ ok: true, value: saved() });
    const { container } = await render(editPath, mocks, { update });
    await field(container, "description", "Otro"); await click(rowAction(container, P2));
    await submit(container);
    expect(alerts(container).map((item) => item.textContent)).toEqual(["Una foto que querías quitar ya no pertenece a este recuerdo. Actualizamos la lista."]);
    expect(list).toHaveBeenCalledTimes(2);
    expect(value(container, "description")).toBe("Otro");
    await submit(container);
    expect(update).toHaveBeenLastCalledWith(tripId, postId, { description: "Otro" });
  });
  it("a 422 description/required with the removal shows the content message and keeps the mark", async () => {
    const mocks = makeDeps(); withList(mocks);
    const update = vi.fn().mockResolvedValue({ ok: false, error: { kind: "validation", fields: [{ field: "description", code: "required", message: "x" }] } });
    const { container } = await render(editPath, mocks, { update, get: withPost({ description: null, mapsUrl: null }) });
    await click(rowAction(container, P1)); await click(rowAction(container, P2));
    await submit(container);
    expect(alerts(container).map((item) => item.textContent)).toEqual([missing]);
    expect(container.querySelector(`[data-published-photo="${P1}"]`)!.textContent).toContain("Se quitará al guardar");
  });
  it("a 403 says only the author edits, re-reads the members and switches to the limited mode", async () => {
    const mocks = makeDeps(); withList(mocks);
    let current = author;
    const update = vi.fn().mockImplementation(async () => { current = other; return { ok: false, error: { kind: "forbidden" } }; });
    const list = vi.fn().mockImplementation(async () => ({ ok: true, value: { currentUserId: current, members: [
      { id: itineraryId(100), userId: author, name: "Ana", role: "participant", joinedAt: "2026-01-01T00:00:00.000Z" },
      { id: itineraryId(101), userId: other, name: "Beto", role: "participant", joinedAt: "2026-01-01T00:00:00.000Z" }] } }));
    const { container } = await render(editPath, mocks, { update }, { list });
    expect(container.querySelector('[name="description"]')).not.toBeNull();
    await click(rowAction(container, P1));
    await submit(container);
    expect(container.textContent).toContain("Solo el autor puede editar el contenido de este recuerdo");
    expect(list.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('[name="description"]')).toBeNull();
    expect(container.querySelector("[data-published-photo]")).toBeNull();
  });
  it("with a new activity and a pending removal it says so and sends nothing", async () => {
    const mocks = makeDeps(); withList(mocks);
    const { container, update } = await render(editPath, mocks);
    await addActivity(container);
    await click(rowAction(container, P1));
    await submit(container);
    expect(update).not.toHaveBeenCalled();
    expect(alerts(container).map((item) => item.textContent)).toEqual(["No se pueden quitar fotos y crear una actividad nueva en el mismo guardado. Deshacé la quita de fotos o quitá la actividad nueva."]);
  });
  it("a member who is not the author sees no photo section and never sends removePhotos", async () => {
    const mocks = makeDeps(), list = withList(mocks);
    const update = vi.fn().mockResolvedValue({ ok: true, value: saved() });
    const { container } = await render(editPath, mocks, { update, get: withPost({ authorId: author }) }, membersFor(other));
    expect(container.querySelector("[data-published-photo]")).toBeNull();
    expect(container.querySelector("[data-published-photos]")).toBeNull();
    expect(list.mock.calls.length).toBeLessThanOrEqual(1);
  });
  it("a network failure on save keeps the removal in the draft", async () => {
    const mocks = makeDeps(); withList(mocks);
    const update = vi.fn().mockResolvedValue({ ok: false, error: { kind: "network" } });
    const { container } = await render(editPath, mocks, { update });
    await click(rowAction(container, P1));
    await submit(container);
    expect(container.querySelector(`[data-published-photo="${P1}"]`)!.textContent).toContain("Se quitará al guardar");
    await submit(container);
    expect(update).toHaveBeenCalledTimes(2);
  });
});
