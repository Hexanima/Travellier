import { describe, expect, it } from "vitest";
import type { PreferencesApi } from "../auth/native-session-storage.js";
import { calendarStoreKey, createCalendarRefStore, emptyCalendarState, type CalendarTripState } from "./calendar-ref-store.js";

const memory = () => {
  const values = new Map<string, string>();
  const preferences: PreferencesApi = {
    get: async ({ key }) => ({ value: values.get(key) ?? null }),
    set: async ({ key, value }) => { values.set(key, value); },
    remove: async ({ key }) => { values.delete(key); },
  };
  return { values, preferences };
};
const trip = "a".repeat(24), other = "b".repeat(24);
const state = (patch: Partial<CalendarTripState> = {}): CalendarTripState => ({
  enabled: true, syncedAt: "2026-11-10T12:00:00.000Z",
  deviceRefs: { "activity-1": { eventId: "ev-1", fingerprint: "abcd", startMs: 1000, endMs: 2000 } }, ...patch,
});

describe("calendar ref store", () => {
  it("reads an empty, disabled state when nothing was stored", async () => {
    expect(await createCalendarRefStore(memory().preferences).read("user-1", trip)).toEqual(emptyCalendarState());
    expect(emptyCalendarState()).toEqual({ enabled: false, deviceRefs: {}, syncedAt: null });
  });
  it("round-trips the state, also from a new store over the same preferences (restart)", async () => {
    const { preferences } = memory();
    await createCalendarRefStore(preferences).write("user-1", trip, state());
    expect(await createCalendarRefStore(preferences).read("user-1", trip)).toEqual(state());
  });
  it("isolates accounts and trips: one never reads or touches the keys of another", async () => {
    const { preferences, values } = memory();
    const store = createCalendarRefStore(preferences);
    await store.write("user-1", trip, state());
    expect(await store.read("user-2", trip)).toEqual(emptyCalendarState());
    expect(await store.read("user-1", other)).toEqual(emptyCalendarState());
    await store.write("user-2", trip, state({ enabled: false }));
    await store.clear("user-2", trip);
    expect(await store.read("user-1", trip)).toEqual(state());
    expect(values.size).toBe(1);
  });
  it("uses a versioned key per account hash and trip, without the raw account id", () => {
    const key = calendarStoreKey("user-1", trip);
    expect(key).toMatch(new RegExp(`^travellier\\.calendar\\.v1\\.[0-9a-f]{16}\\.${trip}$`));
    expect(key).not.toContain("user-1");
    expect(calendarStoreKey("user-2", trip)).not.toBe(key);
  });
  it("clears one trip only", async () => {
    const { preferences } = memory();
    const store = createCalendarRefStore(preferences);
    await store.write("user-1", trip, state());
    await store.write("user-1", other, state());
    await store.clear("user-1", trip);
    expect(await store.read("user-1", trip)).toEqual(emptyCalendarState());
    expect(await store.read("user-1", other)).toEqual(state());
  });
  it("treats corrupt or malformed values as empty", async () => {
    const { preferences, values } = memory();
    const store = createCalendarRefStore(preferences);
    const key = calendarStoreKey("user-1", trip);
    for (const raw of ["{no json", "null", "[]", "7", JSON.stringify({ enabled: "yes", deviceRefs: {}, syncedAt: null }),
      JSON.stringify({ enabled: true, deviceRefs: { a: { eventId: "", fingerprint: "x", startMs: 1, endMs: 2 } }, syncedAt: null }),
      JSON.stringify({ enabled: true, deviceRefs: { a: { eventId: "e", fingerprint: "x", startMs: "1", endMs: 2 } }, syncedAt: null }),
      JSON.stringify({ enabled: true, deviceRefs: [], syncedAt: null }),
      JSON.stringify({ enabled: true, deviceRefs: {}, syncedAt: 5 })]) {
      values.set(key, raw);
      expect(await store.read("user-1", trip)).toEqual(emptyCalendarState());
    }
  });
  it("stores only ids, fingerprints and times: no tokens, titles or content", async () => {
    const { preferences, values } = memory();
    await createCalendarRefStore(preferences).write("user-1", trip, { ...state(), accessToken: "tok", title: "Cena secreta" } as CalendarTripState);
    const stored = [...values.values()].join("");
    expect(stored).not.toMatch(/tok|Cena secreta/);
    expect(Object.keys(JSON.parse(stored) as object).sort()).toEqual(["deviceRefs", "enabled", "syncedAt"]);
  });
  it("keeps the removal-in-progress mark only when it is true and starts without it", async () => {
    const { preferences } = memory();
    const store = createCalendarRefStore(preferences);
    await store.write("user-1", trip, { ...state(), removing: true });
    expect(await store.read("user-1", trip)).toEqual({ ...state(), removing: true });
    await store.write("user-1", other, { ...state(), removing: false });
    expect(await store.read("user-1", other)).toEqual(state());
    expect("removing" in emptyCalendarState()).toBe(false);
  });
});
