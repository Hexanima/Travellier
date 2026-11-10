// Shared test doubles: an in-memory Preferences and a device calendar that behaves like the plugin (marker substring search, first-match modify).
import { vi } from "vitest";
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

export function fakeCalendar() {
  const events = new Map<string, CalendarEventSpec & { calendarId: string }>();
  let nextId = 1;
  const access: CalendarAccess = { read: "prompt", write: "prompt" };
  const dialog = { grant: true };
  const calls: string[] = [];
  const failing = new Map<string, (spec?: CalendarEventSpec) => boolean>();
  const revokeOnCreate = { value: false };
  const gate = { pause: undefined as Promise<void> | undefined };
  const fails = (op: string, spec?: CalendarEventSpec) => failing.get(op)?.(spec) === true;
  const hasMarker = (event: CalendarEventSpec, marker: string) => event.notes.split("\n").includes(marker);
  const port: CalendarEventsPort = {
    find: async (marker, window) => {
      calls.push("find");
      if (fails("find")) return err(new NativeCapabilityError("native"));
      return ok([...events].filter(([, event]) => hasMarker(event, marker) && event.startDate <= window.endMs && event.endDate >= window.startMs)
        .map(([id, event]) => ({ id, startMs: event.startDate, endMs: event.endDate, calendarId: event.calendarId })));
    },
    create: async (spec) => {
      calls.push("create");
      if (gate.pause) await gate.pause;
      if (revokeOnCreate.value) return err(new NativeCapabilityError("denied"));
      if (fails("create", spec)) return err(new NativeCapabilityError("native"));
      const id = `ev-${nextId++}`;
      events.set(id, { ...spec, calendarId: "cal" });
      return ok({ id });
    },
    update: async (marker, window, spec) => {
      calls.push("update");
      if (fails("update", spec)) return err(new NativeCapabilityError("native"));
      const match = [...events].find(([, event]) => hasMarker(event, marker) && event.startDate >= window.startMs && event.endDate <= window.endMs);
      if (!match) return err(new NativeCapabilityError("missing"));
      events.set(match[0], { ...spec, calendarId: match[1].calendarId });
      return ok(undefined);
    },
    remove: async (id) => {
      calls.push("remove");
      if (fails("remove")) return err(new NativeCapabilityError("native"));
      return events.delete(id) ? ok(undefined) : err(new NativeCapabilityError("missing"));
    },
  };
  const accessPort: CalendarAccessPort = {
    checkAccess: vi.fn(async () => ok({ ...access })),
    requestAccess: vi.fn(async () => {
      if (dialog.grant) { if (access.read === "prompt") access.read = "granted"; if (access.write === "prompt") access.write = "granted"; }
      return ok({ ...access });
    }),
  };
  const set = (read: NativePermissionState, write: NativePermissionState) => { access.read = read; access.write = write; };
  return { events, port, accessPort, calls, failing, gate, set, dialog, revokeOnCreate,
    titles: () => [...events.values()].map((event) => event.title).sort(),
    markers: () => [...events.values()].map((event) => event.notes.split("\n").pop()!) };
}

