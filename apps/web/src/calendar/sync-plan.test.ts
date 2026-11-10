import { describe, expect, it } from "vitest";
import { toNativeEventSpec, specFingerprint } from "./native-event-spec.js";
import type { CalendarEvent } from "./calendar-events.js";
import { maxOperationsPerRun, planSync, type DesiredEvent, type DeviceRef } from "./sync-plan.js";

const tripId = "a".repeat(24);
const make = (id: string, patch: Partial<CalendarEvent> = {}): DesiredEvent => {
  const spec = toNativeEventSpec({ key: `activity-${id}`, kind: "activity", id, start: new Date("2026-09-25T12:00:00Z"), end: null, summary: `Plan ${id}`, ...patch }, tripId);
  return { key: `activity-${id}`, spec, fingerprint: specFingerprint(spec) };
};
const refOf = (desired: DesiredEvent, eventId = `ev-${desired.key}`): DeviceRef => ({ eventId, fingerprint: desired.fingerprint, startMs: desired.spec.startDate, endMs: desired.spec.endDate });
const refsOf = (...items: DesiredEvent[]) => Object.fromEntries(items.map((item) => [item.key, refOf(item)]));
const keys = (plan: ReturnType<typeof planSync>) => ({ create: plan.create.map((item) => item.key), update: plan.update.map((item) => item.desired.key), remove: plan.remove.map((item) => item.key), keep: plan.keep });

describe("planSync", () => {
  it("creates what has no reference, keeps what is unchanged and removes what is gone", () => {
    const a = make("1"), b = make("2"), c = make("3");
    expect(keys(planSync([a, b], refsOf(b, c)))).toEqual({ create: [a.key], update: [], remove: [c.key], keep: [b.key] });
  });
  it("is empty and idempotent once the references match the plan", () => {
    const items = [make("1"), make("2")];
    const plan = planSync(items, refsOf(...items));
    expect(plan.create).toEqual([]); expect(plan.update).toEqual([]); expect(plan.remove).toEqual([]);
    expect(plan.keep).toEqual(items.map((item) => item.key));
    expect(planSync(items, refsOf(...items))).toEqual(plan);
  });
  it("updates on a schedule change, a duration change, a content change and a place-only change", () => {
    const base = make("1");
    const variants = [
      make("1", { start: new Date("2026-09-25T13:00:00Z") }),
      make("1", { end: new Date("2026-09-25T14:00:00Z") }),
      make("1", { summary: "Otro título" }),
      make("1", { description: "Nueva descripción" }),
      make("1", { location: "Otro lugar" }),
    ];
    for (const next of variants) {
      const plan = planSync([next], refsOf(base));
      expect(plan.update).toEqual([{ desired: next, ref: refOf(base) }]);
      expect(plan.create).toEqual([]); expect(plan.remove).toEqual([]); expect(plan.keep).toEqual([]);
    }
  });
  it("updates when only the stored window differs although the fingerprint matches", () => {
    const item = make("1");
    const plan = planSync([item], { [item.key]: { ...refOf(item), startMs: item.spec.startDate - 60_000 } });
    expect(plan.update).toHaveLength(1);
  });
  it("removes the event of a deleted activity or transport", () => {
    const transport = make("9", { key: `transport-${"9".repeat(24)}`, kind: "transport", id: "9".repeat(24) });
    const refs = { ...refsOf(make("1")), [`transport-${"9".repeat(24)}`]: refOf(transport) };
    const plan = planSync([make("1")], refs);
    expect(plan.remove).toEqual([{ key: `transport-${"9".repeat(24)}`, ref: refOf(transport) }]);
  });
  it("orders every list by key regardless of input order", () => {
    const items = ["3", "1", "2"].map((id) => make(id));
    expect(planSync(items, {}).create.map((item) => item.key)).toEqual(["activity-1", "activity-2", "activity-3"]);
    const refs = refsOf(...items);
    expect(planSync([], refs).remove.map((item) => item.key)).toEqual(["activity-1", "activity-2", "activity-3"]);
  });
  it("caps the work per run and reports what was deferred; later runs finish it", () => {
    const items = Array.from({ length: maxOperationsPerRun + 7 }, (_, index) => make(String(index).padStart(3, "0")));
    const first = planSync(items, {});
    expect(first.create).toHaveLength(maxOperationsPerRun);
    expect(first.deferred).toBe(7);
    const done = Object.fromEntries(first.create.map((item) => [item.key, refOf(item)]));
    const second = planSync(items, done);
    expect(second.create).toHaveLength(7);
    expect(second.deferred).toBe(0);
    expect(second.keep).toHaveLength(maxOperationsPerRun);
  });
  it("gives removals and updates priority over creations when capping", () => {
    const gone = make("zzz"), stale = make("zz2");
    const fresh = Array.from({ length: maxOperationsPerRun }, (_, index) => make(`a${String(index).padStart(3, "0")}`));
    const plan = planSync([...fresh, make("zz2", { summary: "cambio" })], refsOf(gone, stale));
    expect(plan.remove).toHaveLength(1);
    expect(plan.update).toHaveLength(1);
    expect(plan.create).toHaveLength(maxOperationsPerRun - 2);
    expect(plan.deferred).toBe(2);
  });
});
