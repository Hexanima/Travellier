// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityForm } from "./ActivityForm.js";
import type { ActivityFormContext } from "./activity-form-state.js";
import type { ActivityResponse } from "./trip-activity-api.js";
import type { TripItineraryResponse } from "./trip-itinerary-api.js";
import { itineraryFixture } from "./itinerary-test-fixture.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); vi.restoreAllMocks(); });
async function render(existing?: ActivityResponse, providedContext?: ActivityFormContext) {
  const itinerary = itineraryFixture() as TripItineraryResponse, day = itinerary.days[1];
  const context: ActivityFormContext = providedContext ?? { tripId: itinerary.tripId, days: itinerary.days, timeZone: "America/Argentina/Buenos_Aires",
    selection: { ...day, date: "2026-09-25", sourceDayIds: [day.id] } };
  const create = vi.fn().mockResolvedValue({ ok: true, value: itinerary.activities[0] });
  const update = vi.fn().mockResolvedValue({ ok: true, value: itinerary.activities[0] });
  const onSaved = vi.fn(), onBusyChange = vi.fn();
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<ActivityForm context={context} activities={{ create, update }} existing={existing} onSaved={onSaved} onBusyChange={onBusyChange} />));
  return { container, create, update, onSaved, onBusyChange, root, context };
}
async function field(container: HTMLElement, name: string, value: string) {
  const element = container.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  expect(element, `Field ${name}`).not.toBeNull();
  const proto = element.tagName === "SELECT" ? HTMLSelectElement.prototype : element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value); element.dispatchEvent(new Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true })); });
}
const submit = async (container: HTMLElement) => act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });

describe("ActivityForm", () => {
  it("shows required date and time and submits optional fields as null", async () => {
    const { container, create, onSaved } = await render();
    await field(container, "title", "Nueva actividad"); await field(container, "time", "09:00"); await submit(container);
    expect(create).toHaveBeenCalledWith(itineraryFixture().tripId, { dayId: itineraryFixture().days[1].id, title: "Nueva actividad",
      scheduledAt: "2026-09-25T12:00:00.000Z", description: null, mapsUrl: null });
    expect(onSaved).toHaveBeenCalledOnce();
    expect(container.querySelector('[name="date"]')).toHaveProperty("required", true);
    expect(container.querySelector('[name="time"]')).toHaveProperty("required", true);
  });
  it("shows errors without sending an invalid form", async () => {
    const { container, create } = await render(); await submit(container);
    expect(container.querySelectorAll('[aria-invalid="true"]')).toHaveLength(2);
    expect(create).not.toHaveBeenCalled();
    await field(container, "title", "Museo"); await field(container, "time", "06:00"); await submit(container);
    expect(container.textContent).toContain("dentro de la franja"); expect(create).not.toHaveBeenCalled();
  });
  it("lets the user explicitly choose and see the exact start without rounding entered clocks", async () => {
    const { context } = await render();
    context.days[1].startsAt = context.selection.startsAt = "2026-09-25T13:00:00.123Z";
    context.days[1].endsAt = context.selection.endsAt = "2026-09-25T13:00:59.789Z";
    const { container, create } = await render(undefined, context);
    await field(container, "title", "Llegada"); await field(container, "time", "10:00"); await submit(container);
    expect(create).not.toHaveBeenCalled();
    const chooseStart = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Usar inicio de franja");
    expect(chooseStart).toBeDefined();
    await act(async () => chooseStart!.click());
    const exact = container.querySelector<HTMLTimeElement>(`time[datetime="${context.selection.startsAt}"]`);
    expect(exact?.textContent).toContain("10:00:00,123");
    expect(container.querySelector('[name="time"]')).toHaveProperty("value", "10:00");
    await submit(container);
    expect(create).toHaveBeenCalledWith(context.tripId, expect.objectContaining({ scheduledAt: context.selection.startsAt }));
  });
  it("prefills spontaneous occurrence time and allows correcting it", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-25T13:34:56.789Z"));
    const { container, create } = await render(); await field(container, "mode", "spontaneous");
    expect(container.querySelector('[name="time"]')).toHaveProperty("value", "10:34");
    await field(container, "title", "Almuerzo"); await field(container, "time", "10:00"); await submit(container);
    expect(create).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ scheduledAt: "2026-09-25T13:00:00.000Z" }));
  });
  it("edits only changed fields and clears optional content without rewriting the timestamp", async () => {
    const existing = { ...itineraryFixture().activities[0], description: "Antes", mapsUrl: "https://maps.google.com/" } as ActivityResponse;
    const { container, create, update } = await render(existing);
    expect(container.querySelector('[name="time"]')).toHaveProperty("value", "09:00");
    await field(container, "title", "Nuevo título"); await field(container, "description", ""); await field(container, "mapsUrl", ""); await submit(container);
    expect(update).toHaveBeenCalledWith(existing.tripId, existing.id, { title: "Nuevo título", description: null, mapsUrl: null });
    expect(create).not.toHaveBeenCalled();
  });
  it("does not send an empty PATCH", async () => {
    const { container, update } = await render(itineraryFixture().activities[0] as ActivityResponse); await submit(container);
    expect(update).not.toHaveBeenCalled(); expect(container.textContent).toContain("No hay cambios para guardar");
  });
  it("describes rescheduling within the destination instead of restricting edits to the original band", async () => {
    const { container } = await render(itineraryFixture().activities[0] as ActivityResponse);
    expect(container.textContent).toContain("Podés reprogramar dentro de las franjas de actividad de este destino.");
    expect(container.textContent).not.toContain("Franja disponible:");
  });
  it("preserves unchanged text exactly while editing another field", async () => {
    const existing = { ...itineraryFixture().activities[0], title: " Paseo ", description: "  Primera línea\nSegunda línea  " } as ActivityResponse;
    const { container, update } = await render(existing);
    await field(container, "mapsUrl", "https://maps.app.goo.gl/example"); await submit(container);
    expect(update).toHaveBeenCalledWith(existing.tripId, existing.id, { mapsUrl: "https://maps.app.goo.gl/example" });
  });
  it("prevents duplicate requests and disables controls while saving", async () => {
    let resolve!: (value: unknown) => void;
    const { container, create, onBusyChange } = await render();
    create.mockReturnValue(new Promise((done) => { resolve = done; }));
    await field(container, "title", "Museo"); await field(container, "time", "09:00"); await submit(container); await submit(container);
    expect(create).toHaveBeenCalledOnce(); expect(container.querySelector('[name="title"]')).toHaveProperty("disabled", true);
    expect(onBusyChange).toHaveBeenCalledWith(true);
    await act(async () => resolve({ ok: true, value: itineraryFixture().activities[0] }));
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });
  it.each(["network", "validation", "not-found", "unauthorized"])("keeps entered data after %s errors", async (kind) => {
    const { container, create, onSaved } = await render();
    create.mockResolvedValue({ ok: false, error: { kind, fields: [{ field: "scheduledAt", message: "Outside window" }] } });
    await field(container, "title", "Museo"); await field(container, "time", "09:00"); await submit(container);
    expect(container.querySelector('[name="title"]')).toHaveProperty("value", "Museo");
    expect(container.querySelector('[role="alert"]')).not.toBeNull(); expect(onSaved).not.toHaveBeenCalled();
    if (kind === "validation") expect(container.querySelector('[name="time"]')).toHaveProperty("ariaInvalid", "true");
    if (kind === "unauthorized") expect(container.querySelector('a[href="/login"]')).not.toBeNull();
  });
});
