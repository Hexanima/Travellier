// Shared test doubles: an in-memory Preferences and a device calendar that reproduces what the INSTALLED @capacitor/calendar 1.x does natively.
// Read from node_modules/@capacitor/calendar: android/.../Calendar.kt and ios/.../Calendar.swift. Nothing here was run on a device.
//  - findEvents/modifyEvent/deleteEvent-by-filter: case-insensitive SUBSTRING of title/location/notes, and every event whose interval OVERLAPS the
//    window (Kotlin queryEvents 262-316, Swift findMatchingEvents 185-217). Android orders by start (Kotlin 310); iOS keeps the store order.
//  - modifyEvent changes the FIRST match only and only the fields present (Kotlin 72-120, Swift 73-83). Android ignores empty strings (optString
//    505-507, so «clearing» a location or notes is impossible) and ignores `url`; iOS applies `location: ""` but ignores an empty/invalid url.
//  - createEvent on Android appends the url to the notes as "$notes $url" (Kotlin 43-51); on iOS the url is a separate field (Swift 252-254).
import { vi } from "vitest";
import { createCalendarEvents } from "../native/calendar-events.js";
import type { NativeDependencies } from "../native/capabilities.js";
import { err, NativeCapabilityError, ok, type CalendarAccess, type CalendarAccessPort, type CalendarEventsPort, type CalendarEventSpec, type NativePermissionState } from "app-domain";
import type { PreferencesApi } from "../auth/native-session-storage.js";

export const memoryPreferences = () => {
  const values = new Map<string, string>();
  const preferences: PreferencesApi = {
    get: async ({ key }) => ({ value: values.get(key) ?? null }),
    set: async ({ key, value }) => { values.set(key, value); },
    remove: async ({ key }) => { values.delete(key); },
  };
  return { values, preferences };
};

/** What the device stores for an event. `notes` is "" when absent. */
export type StoredEvent = { title: string; notes: string; location?: string; url?: string; startDate: number; endDate: number; calendarId: string };
type Fields = { title?: string; notes?: string; location?: string; url?: string; startDate?: number; endDate?: number; calendarId?: string };
type Filter = { title?: string; location?: string; notes?: string; startDate?: number; endDate?: number };

const noMatch = () => Object.assign(new Error("no match"), { code: "OS-PLUG-CLDR-0001" });
const contains = (haystack: string | undefined, needle: string | undefined) => !needle || (haystack ?? "").toLowerCase().includes(needle.toLowerCase());

export function fakeCalendar(platform: "android" | "ios" = "android") {
  const events = new Map<string, StoredEvent>();
  let nextId = 1;
  const access: CalendarAccess = { read: "prompt", write: "prompt" };
  const dialog = { grant: true };
  const calls: string[] = [];
  const pluginCalls: string[] = [];
  const failing = new Map<string, (spec?: CalendarEventSpec) => boolean>();
  /** Failures injected INSIDE the adapter, at the plugin call (keys: createEvent, deleteEvent, modifyEvent); the predicate receives the call number (1-based) for that operation. */
  const pluginFailing = new Map<string, (call: number) => boolean>();
  const pluginCount = new Map<string, number>();
  const pluginFails = (op: string) => {
    const call = (pluginCount.get(op) ?? 0) + 1;
    pluginCount.set(op, call);
    return pluginFailing.get(op)?.(call) === true;
  };
  const revokeOnCreate = { value: false };
  const gate = { pause: undefined as Promise<void> | undefined };
  const fails = (op: string, spec?: CalendarEventSpec) => failing.get(op)?.(spec) === true;
  const android = platform === "android";

  const matching = (filter: Filter) => {
    const found = [...events].filter(([, event]) => contains(event.title, filter.title) && contains(event.location, filter.location) && contains(event.notes, filter.notes)
      && event.startDate <= (filter.endDate ?? Infinity) && event.endDate >= (filter.startDate ?? -Infinity));
    return android ? found.sort((a, b) => a[1].startDate - b[1].startDate) : found;
  };
  const plugin = {
    findEvents: async (filter: Filter) => {
      pluginCalls.push("findEvents");
      return { events: matching(filter).map(([id, event]) => ({ id, title: event.title, ...(event.location !== undefined ? { location: event.location } : {}),
        ...(event.notes !== "" ? { notes: event.notes } : {}), startDate: event.startDate, endDate: event.endDate, isAllDay: false, calendarId: event.calendarId })) };
    },
    createEvent: async (options: Fields) => {
      pluginCalls.push("createEvent");
      if (pluginFails("createEvent")) throw new Error("plugin create failed");
      const id = `ev-${nextId++}`;
      const notes = android && options.url ? (options.notes ? `${options.notes} ${options.url}` : options.url) : options.notes ?? "";
      events.set(id, { title: options.title ?? "", notes, ...(options.location ? { location: options.location } : {}), ...(!android && options.url ? { url: options.url } : {}),
        startDate: options.startDate ?? 0, endDate: options.endDate ?? 0, calendarId: options.calendarId ?? "cal" });
      return { id };
    },
    modifyEvent: async ({ filter, newEvent }: { filter: Filter; newEvent: Fields }) => {
      pluginCalls.push("modifyEvent");
      const first = matching(filter)[0];
      if (!first) throw noMatch();
      const [id, event] = first;
      const next = { ...event };
      const apply = (value: string | undefined) => (android ? value !== undefined && value !== "" : value !== undefined);
      if (newEvent.title !== undefined && (android ? newEvent.title !== "" : true)) next.title = newEvent.title;
      if (apply(newEvent.location)) next.location = newEvent.location!;
      if (apply(newEvent.notes)) next.notes = newEvent.notes!;
      if (newEvent.startDate !== undefined) next.startDate = newEvent.startDate;
      if (newEvent.endDate !== undefined) next.endDate = newEvent.endDate;
      if (!android && newEvent.url) next.url = newEvent.url;
      events.set(id, next);
    },
    deleteEvent: async ({ id }: { id?: string }) => {
      pluginCalls.push("deleteEvent");
      if (pluginFails("deleteEvent")) throw new Error("plugin delete failed");
      if (!id || !events.delete(id)) throw noMatch();
    },
  };
  const adapter = createCalendarEvents(plugin as unknown as NativeDependencies["calendar"], () => platform);
  // Port-level wrapper: records the operation names and injects failures, a pause or a permission revocation.
  const port: CalendarEventsPort = {
    find: async (...args) => { calls.push("find"); if (fails("find")) return err(new NativeCapabilityError("native")); return adapter.find(...args); },
    create: async (...args) => {
      calls.push("create");
      if (gate.pause) await gate.pause;
      if (revokeOnCreate.value) return err(new NativeCapabilityError("denied"));
      if (fails("create", args[0])) return err(new NativeCapabilityError("native"));
      return adapter.create(...args);
    },
    update: async (...args: unknown[]) => {
      calls.push("update");
      if (fails("update", args[args.length - 1] as CalendarEventSpec)) return err(new NativeCapabilityError("native"));
      return (adapter.update as (...rest: unknown[]) => ReturnType<CalendarEventsPort["update"]>)(...args);
    },
    remove: async (...args) => { calls.push("remove"); if (fails("remove")) return err(new NativeCapabilityError("native")); return adapter.remove(...args); },
  };
  const accessPort: CalendarAccessPort = {
    checkAccess: vi.fn(async () => ok({ ...access })),
    requestAccess: vi.fn(async () => {
      if (dialog.grant) { if (access.read === "prompt") access.read = "granted"; if (access.write === "prompt") access.write = "granted"; }
      return ok({ ...access });
    }),
  };
  const set = (read: NativePermissionState, write: NativePermissionState) => { access.read = read; access.write = write; };
  /** An event the user created by hand (not through the app). */
  const addForeign = (id: string, event: Partial<StoredEvent> & Pick<StoredEvent, "startDate" | "endDate">) => { events.set(id, { title: "Ajeno", notes: "", calendarId: "cal", ...event }); };
  return { events, port, plugin, accessPort, calls, pluginCalls, failing, pluginFailing, gate, set, dialog, revokeOnCreate, platform, addForeign,
    titles: () => [...events.values()].map((event) => event.title).sort(),
    markers: () => [...events.values()].map((event) => event.notes.split("\n").pop()!) };
}
