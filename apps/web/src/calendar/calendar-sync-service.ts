import type { CalendarAccess, CalendarAccessPort, CalendarEventsPort, NativePermissionState } from "app-domain";
import type { TripItineraryResponse } from "../trips/trip-itinerary-api.js";
import { buildCalendarEvents } from "./calendar-events.js";
import type { CalendarRefStore } from "./calendar-ref-store.js";
import { eventMarker, specFingerprint, toNativeEventSpec } from "./native-event-spec.js";
import { planSync, type DesiredEvent, type DeviceRef } from "./sync-plan.js";

/**
 * `synced` is only ever reported after every operation of a run succeeded. `denied.limited` is write-only access (iOS «Add Events Only»):
 * events cannot be searched or updated, so it is not synchronizable and the .ics export is offered instead.
 */
export type CalendarSyncStatus =
  | { state: "checking" }
  | { state: "off" }
  | { state: "needs-account" }
  | { state: "needs-permission" }
  /** `enabled`: the user had turned sync on, so «Dejar de sincronizar» makes sense (it needs no permission). */
  | { state: "denied"; limited: boolean; enabled?: boolean }
  /** «Quitar del calendario» failed for some events: they and their references are kept, and nothing syncs until the removal is retried or sync is stopped. */
  | { state: "removing-partial"; remaining: number }
  | { state: "syncing" }
  | { state: "pending" }
  | { state: "synced"; at: string }
  | { state: "partial"; failed: number; at: string | null }
  | { state: "error" };

export type CalendarSyncService = {
  getStatus: (tripId: string) => CalendarSyncStatus;
  subscribe: (listener: () => void) => () => void;
  /** Silent: reads what was saved and the permission; never shows a dialog and never writes to the calendar. */
  init: (tripId: string) => Promise<void>;
  /** Explicit user action: asks for calendar access if still undecided, saves the opt-in and synchronizes. */
  enable: (tripId: string, itinerary: TripItineraryResponse) => Promise<void>;
  /** Stops syncing; the events already in the calendar stay. */
  disable: (tripId: string) => Promise<void>;
  /** Triggered by an itinerary load or refresh; does nothing unless enabled. One run per Trip at a time; later calls queue one pass with the latest itinerary. */
  sync: (tripId: string, itinerary: TripItineraryResponse) => Promise<void>;
  /** Explicit «add again»: verifies each event is still in the calendar and re-creates the ones deleted outside the app. */
  restore: (tripId: string, itinerary: TripItineraryResponse) => Promise<void>;
  /** Deletes the events this device created for the Trip, forgets them and turns sync off. */
  removeAll: (tripId: string) => Promise<{ removed: number; failed: number }>;
};

type Dependencies = { access: CalendarAccessPort; events: CalendarEventsPort; store: CalendarRefStore; accountId: () => string | null; now: () => Date;
  /** Upper bound of passes per run (default 50, so 50 x 50 operations). */
  passes?: number };
type Slot = { next: TripItineraryResponse | undefined; done: Promise<void> };

const day = 86_400_000;
/** Search range for adoption by marker: the plan may have moved since the event was created. */
const searchWindow = (startMs: number, endMs: number) => ({ startMs: Math.min(startMs, endMs) - 400 * day, endMs: Math.max(startMs, endMs) + 400 * day });
/** Targets the event by its previous window with a small tolerance (the plugin may truncate to seconds). */
const around = (ref: DeviceRef) => ({ startMs: ref.startMs - 60_000, endMs: ref.endMs + 60_000 });
const prompting = (value: NativePermissionState) => value === "prompt" || value === "prompt-with-rationale";
const defaultPasses = 50;
// Stable references: React reads the status as an external store snapshot.
const checking: CalendarSyncStatus = { state: "checking" };
const needsAccount: CalendarSyncStatus = { state: "needs-account" };

export function createCalendarSyncService({ access, events, store, accountId, now, passes: maxPasses = defaultPasses }: Dependencies): CalendarSyncService {
  const statuses = new Map<string, CalendarSyncStatus>();
  const listeners = new Set<() => void>();
  const chains = new Map<string, Promise<unknown>>();
  const slots = new Map<string, Slot>();
  const keyOf = (account: string, tripId: string) => `${account}\u0000${tripId}`;
  const setStatus = (key: string, status: CalendarSyncStatus) => { statuses.set(key, status); listeners.forEach((listener) => listener()); };

  /** Serializes everything that touches one Trip of one account. */
  const exclusive = <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const result = (chains.get(key) ?? Promise.resolve()).then(task);
    const tail = result.then(() => undefined, () => undefined);
    chains.set(key, tail);
    void tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
    return result;
  };

  /** Never prompts unless `request`; leaves the status describing why it cannot proceed and answers whether it can. */
  async function ensureAccess(key: string, request: boolean): Promise<boolean> {
    const checked = await access.checkAccess();
    // `request` is only true while enabling, when the opt-in was not saved yet.
    const denied = (limited: boolean): CalendarSyncStatus => ({ state: "denied", limited, enabled: !request });
    if (!checked.ok) { setStatus(key, checked.error.kind === "denied" ? denied(false) : checked.error.kind === "unsupported" ? { state: "off" } : { state: "error" }); return false; }
    let current: CalendarAccess = checked.value;
    if (request && (prompting(current.read) || prompting(current.write))) {
      const asked = await access.requestAccess("manage");
      if (!asked.ok) { setStatus(key, asked.error.kind === "denied" ? denied(false) : { state: "error" }); return false; }
      current = asked.value;
    }
    if (current.read === "granted" && current.write === "granted") return true;
    if (prompting(current.read) || prompting(current.write)) setStatus(key, { state: "needs-permission" });
    else setStatus(key, denied(current.write === "granted"));
    return false;
  }

  async function run(account: string, tripId: string, itinerary: TripItineraryResponse, verify: boolean): Promise<void> {
    const key = keyOf(account, tripId);
    const saved = await store.read(account, tripId);
    if (saved.removing) { setStatus(key, { state: "removing-partial", remaining: Object.keys(saved.deviceRefs).length }); return; }
    if (!saved.enabled) { setStatus(key, { state: "off" }); return; }
    setStatus(key, { state: "syncing" });
    if (!(await ensureAccess(key, false))) return;
    const desired: DesiredEvent[] = buildCalendarEvents(itinerary).map((event) => {
      const spec = toNativeEventSpec(event, tripId);
      return { key: event.key, spec, fingerprint: specFingerprint(spec) };
    });
    const byKey = new Map(desired.map((item) => [item.key, item]));
    const refs: Record<string, DeviceRef> = { ...saved.deviceRefs };
    const failed = new Set<string>();
    let succeeded = 0, revoked = false;
    const persist = () => store.write(account, tripId, { enabled: true, deviceRefs: refs, syncedAt: saved.syncedAt });
    // A permission revoked while running stops the whole run; anything else only fails that key.
    const settle = (result: { ok: boolean; error?: { kind: string } }, itemKey: string) => {
      if (result.ok) return true;
      if (result.error?.kind === "denied") revoked = true; else failed.add(itemKey);
      return false;
    };

    if (verify) {
      for (const item of desired) {
        const ref = refs[item.key];
        if (!ref || revoked) continue;
        const found = await events.find(eventMarker(item.key, tripId), searchWindow(item.spec.startDate, item.spec.endDate));
        if (!settle(found, item.key)) continue;
        if (!found.ok) continue;
        if (found.value.length === 0) delete refs[item.key];
        else if (found.value[0]!.id !== ref.eventId) refs[item.key] = { ...ref, eventId: found.value[0]!.id };
      }
      await persist();
    }

    const adoptOrCreate = async (item: DesiredEvent): Promise<void> => {
      const marker = eventMarker(item.key, tripId);
      // Look before creating: a previous run may have created it and died before saving the reference (or the app was reinstalled).
      const found = await events.find(marker, searchWindow(item.spec.startDate, item.spec.endDate));
      if (!settle(found, item.key) || !found.ok) return;
      if (found.value.length > 0) {
        const [keep, ...extra] = found.value;
        refs[item.key] = { eventId: keep!.id, fingerprint: "adopted", startMs: keep!.startMs, endMs: keep!.endMs };
        await persist();
        for (const copy of extra) await events.remove(copy.id);
        return;
      }
      const created = await events.create(item.spec);
      if (!settle(created, item.key) || !created.ok) return;
      refs[item.key] = { eventId: created.value.id, fingerprint: item.fingerprint, startMs: item.spec.startDate, endMs: item.spec.endDate };
      await persist();
      succeeded += 1;
    };

    const pendingPlan = () => planSync(desired.filter((item) => !failed.has(item.key)), Object.fromEntries(Object.entries(refs).filter(([refKey]) => !failed.has(refKey))));
    let progressed = false;
    for (let pass = 0; pass < maxPasses && !revoked; pass += 1) {
      const plan = pendingPlan();
      if (plan.create.length + plan.update.length + plan.remove.length === 0) break;
      const before = succeeded;
      for (const { key: refKey, ref } of plan.remove) {
        if (revoked) break;
        const removed = await events.remove(ref.eventId);
        // «Missing» means someone already deleted it: the goal is reached.
        if (removed.ok || removed.error.kind === "missing") { delete refs[refKey]; await persist(); succeeded += 1; } else settle(removed, refKey);
      }
      for (const { desired: item, ref } of plan.update) {
        if (revoked) break;
        const updated = await events.update(ref.eventId, eventMarker(item.key, tripId), around(ref), item.spec);
        // The adapter may have had to create the event again: it answers the id to keep.
        if (updated.ok) { refs[item.key] = { eventId: updated.value.id, fingerprint: item.fingerprint, startMs: item.spec.startDate, endMs: item.spec.endDate }; await persist(); succeeded += 1; }
        // Not found where it was: deleted or moved outside the app. Forget the reference; the next pass adopts it by marker or creates it again.
        else if (updated.error.kind === "missing") { delete refs[item.key]; await persist(); } else settle(updated, item.key);
      }
      for (const item of plan.create) { if (revoked) break; await adoptOrCreate(item); }
      progressed = succeeded > before;
    }

    if (revoked) { await store.write(account, tripId, { enabled: true, deviceRefs: refs, syncedAt: null }); setStatus(key, { state: "denied", limited: false }); return; }
    // The passes can run out (or loop) with work left: never report «synced» unless nothing remains to do.
    const left = pendingPlan();
    const leftCount = left.create.length + left.update.length + left.remove.length;
    if (failed.size === 0 && leftCount === 0) {
      const at = now().toISOString();
      await store.write(account, tripId, { enabled: true, deviceRefs: refs, syncedAt: at });
      setStatus(key, { state: "synced", at });
      return;
    }
    await store.write(account, tripId, { enabled: true, deviceRefs: refs, syncedAt: null });
    if (failed.size === 0) { setStatus(key, progressed ? { state: "pending" } : { state: "partial", failed: leftCount, at: null }); return; }
    const kept = Object.keys(refs).filter((refKey) => !failed.has(refKey) && byKey.has(refKey)).length;
    setStatus(key, succeeded + kept === 0 ? { state: "error" } : { state: "partial", failed: failed.size, at: null });
  }

  /** Whatever goes wrong, the status says error: never «synced», never an exception into the UI, never content in a log. */
  const guarded = async (key: string, task: () => Promise<void>) => { try { await task(); } catch { setStatus(key, { state: "error" }); } };

  return {
    getStatus: (tripId) => {
      const account = accountId();
      if (account === null) return needsAccount;
      return statuses.get(keyOf(account, tripId)) ?? checking;
    },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    init: async (tripId) => {
      const account = accountId();
      if (account === null) return;
      const key = keyOf(account, tripId);
      await exclusive(key, () => guarded(key, async () => {
        const saved = await store.read(account, tripId);
        if (saved.removing) { setStatus(key, { state: "removing-partial", remaining: Object.keys(saved.deviceRefs).length }); return; }
        if (!saved.enabled) { setStatus(key, { state: "off" }); return; }
        if (!(await ensureAccess(key, false))) return;
        const current = statuses.get(key);
        if (current && ["syncing", "synced", "partial", "error"].includes(current.state)) { setStatus(key, current); return; }
        setStatus(key, saved.syncedAt ? { state: "synced", at: saved.syncedAt } : { state: "pending" });
      }));
    },
    enable: (tripId, itinerary) => {
      const account = accountId();
      if (account === null) return Promise.resolve();
      const key = keyOf(account, tripId);
      return exclusive(key, () => guarded(key, async () => {
        if (!(await ensureAccess(key, true))) return;
        const saved = await store.read(account, tripId);
        await store.write(account, tripId, { ...saved, enabled: true, removing: false });
        await run(account, tripId, itinerary, false);
      }));
    },
    disable: (tripId) => {
      const account = accountId();
      if (account === null) return Promise.resolve();
      const key = keyOf(account, tripId);
      return exclusive(key, () => guarded(key, async () => {
        const saved = await store.read(account, tripId);
        await store.write(account, tripId, { ...saved, enabled: false, removing: false });
        setStatus(key, { state: "off" });
      }));
    },
    sync: (tripId, itinerary) => {
      const account = accountId();
      if (account === null) return Promise.resolve();
      const key = keyOf(account, tripId);
      const queued = slots.get(key);
      if (queued) { queued.next = itinerary; return queued.done; }
      const slot: Slot = { next: itinerary, done: Promise.resolve() };
      slots.set(key, slot);
      slot.done = exclusive(key, () => guarded(key, async () => {
        try {
          // Passes triggered while one is running collapse into one more pass with the latest itinerary.
          for (let latest: TripItineraryResponse | undefined = slot.next; latest;) {
            slot.next = undefined;
            await run(account, tripId, latest, false);
            latest = slot.next;
          }
        } finally { slots.delete(key); }
      }));
      return slot.done;
    },
    restore: (tripId, itinerary) => {
      const account = accountId();
      if (account === null) return Promise.resolve();
      const key = keyOf(account, tripId);
      return exclusive(key, () => guarded(key, () => run(account, tripId, itinerary, true)));
    },
    removeAll: async (tripId) => {
      const account = accountId();
      if (account === null) return { removed: 0, failed: 0 };
      const key = keyOf(account, tripId);
      let outcome = { removed: 0, failed: 0 };
      await exclusive(key, () => guarded(key, async () => {
        const saved = await store.read(account, tripId);
        const entries = Object.entries(saved.deviceRefs);
        if (!(await ensureAccess(key, false))) { outcome = { removed: 0, failed: entries.length }; return; }
        const remaining: Record<string, DeviceRef> = {};
        for (const [refKey, ref] of entries) {
          const removed = await events.remove(ref.eventId);
          if (removed.ok || removed.error.kind === "missing") outcome.removed += 1; else { remaining[refKey] = ref; outcome.failed += 1; }
        }
        if (outcome.failed === 0) { await store.clear(account, tripId); setStatus(key, { state: "off" }); return; }
        // Only the events that could not be deleted keep their reference; a retry deletes just those.
        await store.write(account, tripId, { enabled: true, removing: true, deviceRefs: remaining, syncedAt: null });
        setStatus(key, { state: "removing-partial", remaining: outcome.failed });
      }));
      return outcome;
    },
  };
}
