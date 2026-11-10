import { describe, expect, it, vi } from "vitest";
import { err, NativeCapabilityError, ok, type CalendarEventsPort } from "app-domain";
import { itineraryFixture, itineraryId } from "../trips/itinerary-test-fixture.js";
import type { TripItineraryResponse } from "../trips/trip-itinerary-api.js";
import { fakeCalendar, memoryPreferences } from "./calendar-test-fixture.js";
import { createCalendarRefStore } from "./calendar-ref-store.js";
import { createCalendarSyncService } from "./calendar-sync-service.js";
import { eventMarker } from "./native-event-spec.js";

// Behaviors that depend on what the installed plugin really does (see calendar-test-fixture.ts for the native lines).
const tripId = itineraryId(1);
const place = "https://www.google.com/maps/place/Plaza+San+Mart%C3%ADn/@-31.42,-64.18,17z";
const withPlace = (): TripItineraryResponse => { const itinerary = itineraryFixture() as TripItineraryResponse; itinerary.activities[0]!.mapsUrl = place; return itinerary; };
const plain = () => itineraryFixture() as TripItineraryResponse;
const now = () => new Date("2026-11-10T12:00:00.000Z");

function setup(platform: "android" | "ios", options: { calendar?: ReturnType<typeof fakeCalendar>; prefs?: ReturnType<typeof memoryPreferences>; passes?: number } = {}) {
  const calendar = options.calendar ?? fakeCalendar(platform);
  const prefs = options.prefs ?? memoryPreferences();
  const service = createCalendarSyncService({ access: calendar.accessPort, events: calendar.port, store: createCalendarRefStore(prefs.preferences), accountId: () => "user-1", now,
    ...(options.passes !== undefined ? { passes: options.passes } : {}) });
  return { calendar, prefs, service };
}
const byTitle = (calendar: ReturnType<typeof fakeCalendar>, title: string) => [...calendar.events].find(([, event]) => event.title === title)!;

describe.each(["android", "ios"] as const)("calendar sync over the real plugin semantics (%s)", (platform) => {
  it("an activity with a maps link is found again by its marker: «add again» and adoption do not duplicate it", async () => {
    const { service, calendar } = setup(platform);
    await service.enable(tripId, withPlace());
    expect(calendar.events.size).toBe(5);
    await service.restore(tripId, withPlace());
    expect(calendar.events.size).toBe(5);
    expect(service.getStatus(tripId).state).toBe("synced");
    // The reference is lost (reinstall): the marker must adopt, not duplicate.
    const again = setup(platform, { calendar });
    await again.service.enable(tripId, withPlace());
    expect(calendar.events.size).toBe(5);
  });
  it("a place or link removed in the app is cleared from the native event, and the status is synced only after that", async () => {
    const { service, calendar } = setup(platform);
    await service.enable(tripId, withPlace());
    const [id, before] = byTitle(calendar, "Paseo por el centro");
    expect(before.location).toBeTruthy();
    expect(`${before.notes}${before.url ?? ""}`).toContain("google.com/maps");
    await service.sync(tripId, plain());
    const after = calendar.events.get(id) ?? byTitle(calendar, "Paseo por el centro")[1];
    expect(after.location ?? "").toBe("");
    expect(`${after.notes}${after.url ?? ""}`).not.toContain("google.com/maps");
    expect(after.notes.split("\n").pop()).toBe(eventMarker(`activity-${itineraryId(8)}`, tripId));
    expect(calendar.events.size).toBe(5);
    expect(service.getStatus(tripId).state).toBe("synced");
  });
  it("an update never modifies a foreign event that merely contains the marker in the same window", async () => {
    const calendar = fakeCalendar(platform);
    const [first] = (plain() as TripItineraryResponse).activities;
    const marker = eventMarker(`activity-${first!.id}`, tripId);
    const start = new Date(first!.scheduledAt as string).getTime();
    // Inserted first and starting earlier: it is the first match for both Android (ordered by start) and iOS (store order).
    calendar.addForeign("foreign", { title: "Cita del usuario", notes: `mi cita ${marker}`, startDate: start - 30_000, endDate: start + 1_000 });
    const { service } = setup(platform, { calendar });
    await service.enable(tripId, plain());
    const edited = plain();
    edited.activities[0]!.title = "Paseo v2";
    await service.sync(tripId, edited);
    expect(calendar.events.get("foreign")).toMatchObject({ title: "Cita del usuario", notes: `mi cita ${marker}` });
    expect(calendar.titles()).toContain("Paseo v2");
    expect(calendar.titles()).not.toContain("Paseo por el centro");
    expect(service.getStatus(tripId).state).toBe("synced");
  });
  it("the update is tied to the referenced event: a copy carrying the same marker is removed and the referenced one is kept", async () => {
    const { service, calendar } = setup(platform);
    await service.enable(tripId, plain());
    const [id, original] = byTitle(calendar, "Paseo por el centro");
    calendar.events.set("copy", { ...original });
    const edited = plain();
    edited.activities[0]!.title = "Paseo v2";
    await service.sync(tripId, edited);
    const matches = [...calendar.events].filter(([, event]) => event.title === "Paseo v2");
    expect(matches).toHaveLength(1);
    expect(matches[0]![0]).toBe(id);
    expect(calendar.events.has("copy")).toBe(false);
    expect(calendar.events.size).toBe(5);
    expect(service.getStatus(tripId).state).toBe("synced");
  });
});

describe("calendar sync that cannot converge or is capped", () => {
  it("an adopt → update missing → forget loop ends as partial, never synced", async () => {
    const calendar = fakeCalendar("ios");
    const events: CalendarEventsPort = {
      find: async (marker) => { void marker; return ok([{ id: "stuck", startMs: 0, endMs: 0 }]); },
      create: async () => ok({ id: "new" }),
      update: async () => err(new NativeCapabilityError("missing")),
      remove: async () => ok(undefined),
    };
    const service = createCalendarSyncService({ access: calendar.accessPort, events, store: createCalendarRefStore(memoryPreferences().preferences), accountId: () => "user-1", now });
    await service.enable(tripId, plain());
    expect(service.getStatus(tripId).state).toBe("partial");
  });
  it("more work than the passes allow ends as pending, and the next run completes it", async () => {
    const { service, calendar } = setup("android", { passes: 2 });
    const big = plain();
    for (let index = 0; index < 120; index += 1) big.activities.push({ ...big.activities[0]!, id: itineraryId(1000 + index), title: `Plan ${index}` });
    await service.enable(tripId, big);
    expect(service.getStatus(tripId).state).toBe("pending");
    expect(calendar.events.size).toBeLessThan(125);
    await service.sync(tripId, big);
    await service.sync(tripId, big);
    expect(calendar.events.size).toBe(125);
    expect(service.getStatus(tripId).state).toBe("synced");
  });
});

describe("«remove from calendar» with partial failures", () => {
  it("keeps the sync enabled-as-removing, retries only what is left and can be stopped; no sync recreates what was removed", async () => {
    const { service, calendar, prefs } = setup("android");
    await service.enable(tripId, plain());
    let attempts = 0;
    calendar.failing.set("remove", () => { attempts += 1; return attempts > 3; });
    expect(await service.removeAll(tripId)).toEqual({ removed: 3, failed: 2 });
    expect(service.getStatus(tripId)).toEqual({ state: "removing-partial", remaining: 2 });
    expect(calendar.events.size).toBe(2);
    await service.sync(tripId, plain());
    expect(calendar.events.size).toBe(2);
    expect(service.getStatus(tripId).state).toBe("removing-partial");
    // A new session over the same Preferences still knows the removal is unfinished.
    const reopened = setup("android", { calendar, prefs });
    await reopened.service.init(tripId);
    expect(reopened.service.getStatus(tripId)).toEqual({ state: "removing-partial", remaining: 2 });
    calendar.failing.clear();
    calendar.pluginCalls.length = 0;
    expect(await reopened.service.removeAll(tripId)).toEqual({ removed: 2, failed: 0 });
    expect(calendar.pluginCalls.filter((call) => call === "deleteEvent")).toHaveLength(2);
    expect(calendar.events.size).toBe(0);
    expect(reopened.service.getStatus(tripId).state).toBe("off");
  });
  it("«stop syncing» from the partial state leaves the remaining events and references untouched", async () => {
    const { service, calendar, prefs } = setup("android");
    await service.enable(tripId, plain());
    calendar.failing.set("remove", () => true);
    await service.removeAll(tripId);
    await service.disable(tripId);
    expect(service.getStatus(tripId).state).toBe("off");
    expect(calendar.events.size).toBe(5);
    const stored = JSON.parse([...prefs.values.values()][0]!) as { enabled: boolean; deviceRefs: object };
    expect(stored.enabled).toBe(false);
    expect(Object.keys(stored.deviceRefs)).toHaveLength(5);
  });
  it("denied does not block «stop syncing» for an enabled sync", async () => {
    const { service, calendar } = setup("android");
    await service.enable(tripId, plain());
    calendar.set("denied", "denied");
    await service.sync(tripId, plain());
    expect(service.getStatus(tripId)).toMatchObject({ state: "denied", enabled: true });
    await service.disable(tripId);
    expect(service.getStatus(tripId).state).toBe("off");
    expect(vi.isMockFunction(calendar.accessPort.requestAccess)).toBe(true);
  });
});
