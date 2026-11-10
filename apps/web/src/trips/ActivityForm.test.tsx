// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Modal } from "../components/index.js";
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
  const create = vi.fn().mockResolvedValue({ ok: true, value: { activity: itinerary.activities[0], participation: null } });
  const update = vi.fn().mockResolvedValue({ ok: true, value: itinerary.activities[0] });
  const onSaved = vi.fn(), onBusyChange = vi.fn();
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<ActivityForm context={context} activities={{ create, update }} knownActivities={itinerary.activities} existing={existing} onSaved={onSaved} onBusyChange={onBusyChange} />));
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
  it("creates with a duration in minutes from hours and minutes", async () => {
    const { container, create } = await render();
    await field(container, "title", "Museo"); await field(container, "time", "09:00");
    await field(container, "durationHours", "1"); await field(container, "durationMinutes", "30"); await submit(container);
    expect(create).toHaveBeenCalledWith(itineraryFixture().tripId, expect.objectContaining({ durationMinutes: 90, scheduledAt: "2026-09-25T12:00:00.000Z" }));
    expect(container.textContent).toContain("Duración estimada");
    expect(container.textContent).toContain("opcional");
  });
  it("does not send the duration field when none is entered", async () => {
    const { container, create } = await render();
    await field(container, "title", "Museo"); await field(container, "time", "09:00"); await submit(container);
    expect(create.mock.calls[0][1]).not.toHaveProperty("durationMinutes");
  });
  it("shows local duration errors without sending", async () => {
    const { container, create } = await render();
    await field(container, "title", "Museo"); await field(container, "time", "09:00"); await field(container, "durationMinutes", "75"); await submit(container);
    expect(create).not.toHaveBeenCalled();
    expect(container.querySelector('[name="durationMinutes"]')).toHaveProperty("ariaInvalid", "true");
    await field(container, "durationMinutes", "15"); await submit(container);
    expect(create).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ durationMinutes: 15 }));
  });
  it("edits only the duration without resending the timestamp that carries milliseconds", async () => {
    const existing = { ...itineraryFixture().activities[0], durationMinutes: null } as ActivityResponse;
    expect(existing.scheduledAt).toBe("2026-09-25T12:00:00.123Z");
    const { container, update } = await render(existing);
    expect(container.querySelector('[name="durationHours"]')).toHaveProperty("value", "");
    await field(container, "durationHours", "2"); await submit(container);
    expect(update).toHaveBeenCalledWith(existing.tripId, existing.id, { durationMinutes: 120 });
  });
  it("hydrates the existing duration and removes it by sending null", async () => {
    const existing = { ...itineraryFixture().activities[0], durationMinutes: 90 } as ActivityResponse;
    const { container, update } = await render(existing);
    expect(container.querySelector('[name="durationHours"]')).toHaveProperty("value", "1");
    expect(container.querySelector('[name="durationMinutes"]')).toHaveProperty("value", "30");
    await submit(container);
    expect(update).not.toHaveBeenCalled(); expect(container.textContent).toContain("No hay cambios para guardar");
    await field(container, "durationHours", ""); await field(container, "durationMinutes", ""); await submit(container);
    expect(update).toHaveBeenCalledWith(existing.tripId, existing.id, { durationMinutes: null });
  });
  it.each([
    ["outside_window", "La actividad terminaría después de la salida del destino. Acortá la duración o cambiá el horario."],
    ["invalid", "Ingresá una duración válida."],
  ])("shows the %s rejection on the duration and keeps the draft", async (code, text) => {
    const { container, create, onSaved } = await render();
    create.mockResolvedValue({ ok: false, error: { kind: "validation", fields: [{ field: "durationMinutes", code, message: "x" }] } });
    await field(container, "title", "Museo"); await field(container, "time", "09:00"); await field(container, "durationHours", "9"); await submit(container);
    const minutes = container.querySelector<HTMLInputElement>('[name="durationMinutes"]')!;
    expect(container.textContent).toContain(text);
    expect(minutes.getAttribute("aria-invalid")).toBe("true");
    const description = document.getElementById(minutes.getAttribute("aria-describedby")!);
    expect(description?.textContent).toBe(text);
    expect(container.querySelector('[name="durationHours"]')).toHaveProperty("value", "9");
    expect(container.querySelector('[name="title"]')).toHaveProperty("value", "Museo");
    expect(onSaved).not.toHaveBeenCalled();
    await field(container, "durationHours", "1");
    expect(container.textContent).not.toContain(text);
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
  it("plans directly without a type selector or automatically prefilling the occurrence time", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-25T13:34:56.789Z"));
    const { container, create } = await render();
    expect(container.querySelector("select")).toBeNull();
    expect(container.textContent).not.toContain("Tipo de actividad");
    expect(container.textContent).not.toContain("Espontánea");
    expect(container.querySelector('[name="date"]')).toHaveProperty("value", "2026-09-25");
    expect(container.querySelector('[name="time"]')).toHaveProperty("value", "");
    expect(container.textContent).toContain("Hora prevista");
    await field(container, "title", "Almuerzo"); await submit(container);
    expect(create).not.toHaveBeenCalled();
    await field(container, "time", "10:00"); await submit(container);
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
    await act(async () => resolve({ ok: true, value: { activity: itineraryFixture().activities[0], participation: null } }));
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

  describe("participation conflict on creation", () => {
    const confirmation = { confirmedConflicts: [
      { activityId: itineraryFixture().activities[0].id, reason: "overlap", scheduledAt: "2026-09-25T12:00:00.123Z", durationMinutes: 60 },
      { activityId: itineraryFixture().activities[1].id, reason: "same_start", scheduledAt: "2026-09-25T14:00:00.123Z", durationMinutes: null }],
    confirmedActivity: { scheduledAt: "2026-09-25T12:00:00.000Z", durationMinutes: 90 } };
    const conflict = (stale = confirmation) => ({ ok: false, error: { kind: "participation-conflict", confirmation: stale } });
    const draft = async (container: HTMLElement) => {
      await field(container, "title", "Museo"); await field(container, "time", "09:00");
      await field(container, "durationHours", "1"); await field(container, "durationMinutes", "30"); await submit(container);
    };
    const dialogs = () => Array.from(document.querySelectorAll("h2")).filter((h) => h.textContent === "Cambiar de plan");
    const press = async (label: string) => act(async () => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === label)!.click());
    it("opens the modal with all incompatible plans and keeps the draft untouched; cancelling sends and publishes nothing", async () => {
      const { container, create, onSaved } = await render();
      create.mockResolvedValue(conflict());
      await draft(container);
      expect(dialogs()).toHaveLength(1);
      expect(dialogs()[0]!.closest(".participation-conflict-layer"), "stacking proxy: modal mounted in its own layer").not.toBeNull();
      expect(document.querySelectorAll("ul.participation-conflict-list li")).toHaveLength(2);
      expect(document.body.textContent).toContain("Paseo por el centro"); expect(document.body.textContent).toContain("Visita al museo");
      await press("Conservar mi participación actual");
      expect(dialogs()).toHaveLength(0); expect(create).toHaveBeenCalledTimes(1); expect(onSaved).not.toHaveBeenCalled();
      for (const [name, value] of [["title", "Museo"], ["time", "09:00"], ["durationHours", "1"], ["durationMinutes", "30"], ["date", "2026-09-25"]])
        expect(container.querySelector(`[name="${name}"]`)).toHaveProperty("value", value);
    });
    it("confirming resends the same input with the exact confirmation and publishes the activity with its participation", async () => {
      const { container, create, onSaved, onBusyChange } = await render();
      const saved = { activity: itineraryFixture().activities[0], participation: { id: "p" } };
      create.mockResolvedValueOnce(conflict()).mockResolvedValueOnce({ ok: true, value: saved });
      await draft(container); await press("Cambiar de plan");
      expect(create).toHaveBeenCalledTimes(2);
      expect(create.mock.calls[1][1]).toEqual(create.mock.calls[0][1]); expect(create.mock.calls[1][2]).toEqual(confirmation);
      expect(create.mock.calls[0]).toHaveLength(2);
      expect(onSaved).toHaveBeenCalledOnce(); expect(onSaved).toHaveBeenCalledWith(saved.activity, saved.participation);
      expect(dialogs()).toHaveLength(0); expect(onBusyChange).toHaveBeenLastCalledWith(false);
    });
    it("shows the modal again flagged as stale on a second 409, without publishing", async () => {
      const { container, create, onSaved } = await render();
      const fresh = { ...confirmation, confirmedConflicts: [confirmation.confirmedConflicts[0]] };
      create.mockResolvedValueOnce(conflict()).mockResolvedValueOnce(conflict(fresh as never));
      await draft(container); await press("Cambiar de plan");
      expect(dialogs()).toHaveLength(1); expect(document.querySelector('[role="alert"].participation-conflict-stale')).not.toBeNull();
      expect(document.querySelectorAll("ul.participation-conflict-list li")).toHaveLength(1); expect(onSaved).not.toHaveBeenCalled();
      expect(container.querySelector('[name="title"]')).toHaveProperty("value", "Museo");
    });
    it.each(["validation", "network", "server"])("a %s failure while confirming closes the modal, keeps the draft and does not publish", async (kind) => {
      const { container, create, onSaved } = await render();
      create.mockResolvedValueOnce(conflict()).mockResolvedValueOnce({ ok: false, error: { kind } });
      await draft(container); await press("Cambiar de plan");
      expect(dialogs()).toHaveLength(0); expect(onSaved).not.toHaveBeenCalled();
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      expect(container.querySelector('[name="title"]')).toHaveProperty("value", "Museo");
      expect(container.querySelector('[name="durationHours"]')).toHaveProperty("value", "1");
    });
    it("a thrown error while confirming keeps the draft", async () => {
      const { container, create, onSaved } = await render();
      create.mockResolvedValueOnce(conflict()).mockRejectedValueOnce(new Error("Offline"));
      await draft(container); await press("Cambiar de plan");
      expect(dialogs()).toHaveLength(0); expect(onSaved).not.toHaveBeenCalled(); expect(container.querySelector('[name="title"]')).toHaveProperty("value", "Museo");
    });
    it("returns focus to the save button when the conflict modal is cancelled", async () => {
      const { container, create } = await render();
      create.mockResolvedValue(conflict());
      await draft(container);
      await press("Conservar mi participación actual");
      expect(dialogs()).toHaveLength(0);
      expect(document.activeElement).toBe(container.querySelector('button[type="submit"]'));
    });
    it("returns focus to the save button when confirming fails", async () => {
      const { container, create } = await render();
      create.mockResolvedValueOnce(conflict()).mockResolvedValueOnce({ ok: false, error: { kind: "network" } });
      await draft(container); await press("Cambiar de plan");
      expect(dialogs()).toHaveLength(0);
      expect(document.activeElement).toBe(container.querySelector('button[type="submit"]'));
    });
    it("keeps Tab inside the conflict modal when stacked over the activity dialog", async () => {
      const itinerary = itineraryFixture() as TripItineraryResponse, day = itinerary.days[1];
      const context: ActivityFormContext = { tripId: itinerary.tripId, days: itinerary.days, timeZone: "America/Argentina/Buenos_Aires",
        selection: { ...day, date: "2026-09-25", sourceDayIds: [day.id] } };
      const create = vi.fn().mockResolvedValue(conflict());
      const container = document.createElement("div"); document.body.append(container);
      const root = createRoot(container); roots.push(root);
      await act(async () => root.render(<Modal isOpen title="Nueva actividad" onClose={() => undefined}>
        <ActivityForm context={context} activities={{ create, update: vi.fn() }} knownActivities={itinerary.activities} onSaved={vi.fn()} onBusyChange={vi.fn()} /></Modal>));
      await draft(container);
      const inner = dialogs()[0]!.closest('[role="dialog"]') as HTMLElement;
      const controls = Array.from(inner.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
      const first = controls[0]!, last = controls[controls.length - 1]!; // first is the modal's own close button
      const tab = async (shiftKey: boolean) => act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true })); });
      expect(inner.contains(document.activeElement)).toBe(true);
      last.focus(); await tab(false); expect(document.activeElement).toBe(first);
      first.focus(); await tab(true); expect(document.activeElement).toBe(last);
      expect(document.activeElement?.closest('[role="dialog"]')).toBe(inner);
    });
    it("editing never asks for a confirmation and does not forward a participation", async () => {
      const existing = itineraryFixture().activities[0] as ActivityResponse;
      const { container, update, onSaved } = await render(existing);
      await field(container, "title", "Otro"); await submit(container);
      expect(update).toHaveBeenCalledWith(existing.tripId, existing.id, { title: "Otro" });
      expect(onSaved).toHaveBeenCalledWith(itineraryFixture().activities[0], null);
    });
  });
});

describe("ActivityForm location preview", () => {
  it("shows the preview of the typed link below the field and nothing without it", async () => {
    const { container } = await render();
    expect(container.querySelector(".location-preview, [role=status]")).toBeNull();
    await field(container, "mapsUrl", "https://maps.google.com/?q=Plaza+Mayor");
    expect(container.querySelector(".location-preview")?.getAttribute("data-context")).toBe("composer");
    expect(container.querySelector(".location-preview")?.textContent).toContain("Plaza Mayor");
    await field(container, "mapsUrl", "");
    expect(container.querySelector(".location-preview, [role=status]")).toBeNull();
  });
  it("flags an invalid link without blocking the submit or changing the payload", async () => {
    const { container, create } = await render();
    await field(container, "title", "Museo"); await field(container, "time", "09:00");
    await field(container, "mapsUrl", " http://maps.example/x ");
    expect(container.querySelector("[role=status]")?.textContent).toBe("Vínculo de Maps no válido");
    await submit(container);
    expect(create).toHaveBeenCalledWith(itineraryFixture().tripId, expect.objectContaining({ mapsUrl: "http://maps.example/x" }));
  });
  it("sends the trimmed raw text for a valid link, not the normalized href", async () => {
    const { container, create } = await render();
    await field(container, "title", "Museo"); await field(container, "time", "09:00");
    await field(container, "mapsUrl", " https://MAPS.GOOGLE.COM/?q=a "); await submit(container);
    expect(create).toHaveBeenCalledWith(itineraryFixture().tripId, expect.objectContaining({ mapsUrl: "https://MAPS.GOOGLE.COM/?q=a" }));
  });
});
