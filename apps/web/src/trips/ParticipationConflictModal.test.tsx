// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParticipationConflictModal } from "./ParticipationConflictModal.js";
import type { ParticipationConflict } from "./participation-conflict.js";
import { formatActivityRange } from "./activity-time-format.js";
import { itineraryId } from "./itinerary-test-fixture.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });

const conflicts: ParticipationConflict[] = [
  { activityId: itineraryId(8), reason: "overlap", scheduledAt: "2026-09-25T12:00:00.000Z", durationMinutes: 60 },
  { activityId: itineraryId(9), reason: "same_start", scheduledAt: "2026-09-25T12:30:00.000Z", durationMinutes: null },
];
const known = [
  { id: itineraryId(8), title: "Paseo por el centro", scheduledAt: "2026-09-25T12:00:00.000Z", durationMinutes: 60 },
  { id: itineraryId(9), title: "Visita al museo", scheduledAt: "2026-09-25T12:30:00.000Z", durationMinutes: null },
];
async function mount(props: Partial<Parameters<typeof ParticipationConflictModal>[0]> = {}) {
  const trigger = document.createElement("button"); trigger.textContent = "Disparador"; document.body.append(trigger); trigger.focus();
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const onCancel = vi.fn(), onConfirm = vi.fn();
  const render = (extra: typeof props = {}) => act(async () => root.render(<ParticipationConflictModal conflicts={conflicts} activities={known} timeZone="UTC"
    onCancel={onCancel} onConfirm={onConfirm} {...props} {...extra} />));
  await render();
  return { container, trigger, onCancel, onConfirm, render, root };
}
const button = (scope: HTMLElement, label: string) => Array.from(scope.querySelectorAll("button")).find((b) => b.textContent === label || b.getAttribute("aria-label") === label)!;

describe("ParticipationConflictModal", () => {
  it("lists every incompatible activity with title, range and reason", async () => {
    const { container } = await mount();
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Cambiar de plan");
    expect(dialog.textContent).toContain("Esta actividad se superpone con planes en los que ya vas.");
    const items = Array.from(dialog.querySelectorAll("ul li"));
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("Paseo por el centro");
    const first = formatActivityRange(known[0]!, "UTC");
    expect(items[0]!.textContent).toContain(`${first.start} – ${first.end}`); expect(items[0]!.textContent).toContain("Se superpone");
    expect(items[1]!.textContent).toContain("Visita al museo"); expect(items[1]!.textContent).toContain("Mismo horario");
    expect(items[1]!.textContent).toContain(formatActivityRange(known[1]!, "UTC").start);
  });
  it("uses a neutral fallback for an unknown activity, showing the 409 schedule and never the id", async () => {
    const { container, onConfirm } = await mount({ activities: [known[0]!] });
    const items = Array.from(container.querySelectorAll("ul li"));
    expect(items[1]!.textContent).toContain("Otra actividad");
    expect(items[1]!.textContent).toContain(formatActivityRange(conflicts[1]!, "UTC").start);
    expect(container.textContent).not.toContain(itineraryId(9));
    await act(async () => button(container, "Cambiar de plan").click());
    expect(onConfirm).toHaveBeenCalledOnce();
  });
  it("cancels with the keep button and with Escape, and confirms with Cambiar de plan", async () => {
    const { container, onCancel, onConfirm } = await mount();
    await act(async () => button(container, "Conservar mi participación actual").click());
    expect(onCancel).toHaveBeenCalledTimes(1); expect(onConfirm).not.toHaveBeenCalled();
    await act(async () => { container.querySelector("[role=dialog]")!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })); });
    expect(onCancel).toHaveBeenCalledTimes(2);
    await act(async () => button(container, "Cambiar de plan").click());
    expect(onConfirm).toHaveBeenCalledOnce();
  });
  it("shows an alert only when the data changed", async () => {
    const { container, render } = await mount();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await render({ stale: true });
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("Los datos cambiaron. Revisá las actividades y confirmá de nuevo.");
    expect(container.querySelector('[aria-live="assertive"]')).not.toBeNull();
  });
  it("focuses the keep button, and returns focus to the trigger on close", async () => {
    const { container, trigger, root } = await mount();
    expect(document.activeElement).toBe(button(container, "Conservar mi participación actual"));
    expect(container.querySelector('[role="dialog"]')!.contains(document.activeElement)).toBe(true);
    await act(async () => root.render(<div />));
    expect(document.activeElement).toBe(trigger);
  });
  it("disables both actions while saving", async () => {
    const { container, onCancel, onConfirm } = await mount({ saving: true });
    expect(button(container, "Conservar mi participación actual").disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("button[aria-busy=true]")!.disabled).toBe(true);
    container.querySelectorAll("button").forEach((b) => b.click());
    expect(onCancel).not.toHaveBeenCalled(); expect(onConfirm).not.toHaveBeenCalled();
  });
  it("presents «Conservar mi participación actual» as secondary and «Cambiar de plan» as the primary action", async () => {
    const { container } = await mount();
    expect(button(container, "Conservar mi participación actual").classList.contains("ui-button--secondary")).toBe(true);
    expect(button(container, "Cambiar de plan").classList.contains("ui-button--secondary")).toBe(false);
  });
});
