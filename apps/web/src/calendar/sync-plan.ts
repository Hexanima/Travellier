import type { NativeEventSpec } from "./native-event-spec.js";

/** Upper bound of device calendar operations per run, so a huge itinerary never blocks the device; the rest is `deferred` to the next run. */
export const maxOperationsPerRun = 50;

export type DesiredEvent = { key: string; spec: NativeEventSpec; fingerprint: string };
/** What this device remembers about the native event it created or adopted for a key. */
export type DeviceRef = { eventId: string; fingerprint: string; startMs: number; endMs: number };
export type SyncPlan = {
  create: DesiredEvent[];
  update: { desired: DesiredEvent; ref: DeviceRef }[];
  remove: { key: string; ref: DeviceRef }[];
  keep: string[];
  /** Operations left out by the cap. */
  deferred: number;
};

const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Pure and idempotent: with references that already match the plan there is nothing to do. Every list is ordered by key.
 * Removals go first, then updates, then creations when the cap applies.
 */
export function planSync(desired: readonly DesiredEvent[], refs: Readonly<Record<string, DeviceRef>>, { limit = maxOperationsPerRun }: { limit?: number } = {}): SyncPlan {
  const wanted = [...desired].sort((a, b) => byKey(a.key, b.key));
  const wantedKeys = new Set(wanted.map((item) => item.key));
  const remove = Object.keys(refs).filter((key) => !wantedKeys.has(key)).sort(byKey).map((key) => ({ key, ref: refs[key]! }));
  const update: SyncPlan["update"] = [], create: DesiredEvent[] = [], keep: string[] = [];
  for (const item of wanted) {
    const ref = refs[item.key];
    if (!ref) create.push(item);
    else if (ref.fingerprint !== item.fingerprint || ref.startMs !== item.spec.startDate || ref.endMs !== item.spec.endDate) update.push({ desired: item, ref });
    else keep.push(item.key);
  }
  const total = remove.length + update.length + create.length;
  let room = Math.max(limit, 0);
  const take = <T>(list: T[]) => { const taken = list.slice(0, room); room -= taken.length; return taken; };
  const plan = { remove: take(remove), update: take(update), create: take(create) };
  return { ...plan, keep, deferred: total - (plan.remove.length + plan.update.length + plan.create.length) };
}
