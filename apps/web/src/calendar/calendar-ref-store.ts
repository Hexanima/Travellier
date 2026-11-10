import type { PreferencesApi } from "../auth/native-session-storage.js";
import type { DeviceRef } from "./sync-plan.js";
import { hashText } from "./native-event-spec.js";

/**
 * Per account, per Trip and per device: whether the user opted in and the native event each plan key maps to.
 * Preferences is not encrypted, so only opaque ids, fingerprints and times are stored: no tokens, titles or content.
 * The account is scrambled in the key; nothing is deleted on logout (another account has other keys).
 * `removing`: a «remove from calendar» left events behind; `deviceRefs` holds only those and nothing syncs until it is retried or sync is stopped.
 */
export type CalendarTripState = { enabled: boolean; deviceRefs: Record<string, DeviceRef>; syncedAt: string | null; removing?: boolean };

export const emptyCalendarState = (): CalendarTripState => ({ enabled: false, deviceRefs: {}, syncedAt: null });
export const calendarStoreKey = (accountId: string, tripId: string) => `travellier.calendar.v1.${hashText(accountId)}.${tripId}`;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value !== "";
const time = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function parse(raw: string | null): CalendarTripState {
  if (raw === null) return emptyCalendarState();
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || typeof value.enabled !== "boolean" || !isRecord(value.deviceRefs) || !(value.syncedAt === null || typeof value.syncedAt === "string")) return emptyCalendarState();
    const entries: [string, DeviceRef][] = [];
    for (const [key, ref] of Object.entries(value.deviceRefs)) {
      if (!isRecord(ref) || !text(ref.eventId) || !text(ref.fingerprint) || !time(ref.startMs) || !time(ref.endMs)) return emptyCalendarState();
      entries.push([key, { eventId: ref.eventId, fingerprint: ref.fingerprint, startMs: ref.startMs, endMs: ref.endMs }]);
    }
    return { enabled: value.enabled, deviceRefs: Object.fromEntries(entries), syncedAt: value.syncedAt, ...(value.removing === true ? { removing: true } : {}) };
  } catch {
    return emptyCalendarState();
  }
}

export type CalendarRefStore = {
  read: (accountId: string, tripId: string) => Promise<CalendarTripState>;
  write: (accountId: string, tripId: string, state: CalendarTripState) => Promise<void>;
  clear: (accountId: string, tripId: string) => Promise<void>;
};

export const createCalendarRefStore = (preferences: PreferencesApi): CalendarRefStore => ({
  read: async (accountId, tripId) => parse((await preferences.get({ key: calendarStoreKey(accountId, tripId) })).value),
  // Only the known fields are persisted, whatever the caller passes.
  write: (accountId, tripId, state) => preferences.set({ key: calendarStoreKey(accountId, tripId),
    value: JSON.stringify({ enabled: state.enabled, deviceRefs: state.deviceRefs, syncedAt: state.syncedAt, ...(state.removing === true ? { removing: true } : {}) }) }),
  clear: (accountId, tripId) => preferences.remove({ key: calendarStoreKey(accountId, tripId) }),
});
