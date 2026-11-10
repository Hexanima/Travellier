import { afterEach, describe, expect, it, vi } from "vitest";
import { itineraryFixture, itineraryId } from "../trips/itinerary-test-fixture.js";
import type { TripItineraryResponse } from "../trips/trip-itinerary-api.js";
import { fakeCalendar, memoryPreferences } from "./calendar-test-fixture.js";
import { createCalendarRefStore, type CalendarRefStore } from "./calendar-ref-store.js";
import { createCalendarSyncService } from "./calendar-sync-service.js";

afterEach(() => vi.restoreAllMocks());
const tripId = itineraryId(1);
const fixture = () => itineraryFixture() as TripItineraryResponse;
const now = () => new Date("2026-11-10T12:00:00.000Z");

function setup(options: { account?: string | null; calendar?: ReturnType<typeof fakeCalendar>; prefs?: ReturnType<typeof memoryPreferences>; store?: CalendarRefStore } = {}) {
  const calendar = options.calendar ?? fakeCalendar();
  const prefs = options.prefs ?? memoryPreferences();
  const account = { current: options.account === undefined ? "user-1" : options.account };
  const service = createCalendarSyncService({ access: calendar.accessPort, events: calendar.port, store: options.store ?? createCalendarRefStore(prefs.preferences), accountId: () => account.current, now });
  return { calendar, prefs, account, service };
}
const stateOf = (service: ReturnType<typeof setup>["service"]) => service.getStatus(tripId).state;

describe("calendar sync service", () => {
  it("does nothing until the user enables it, and does not touch the calendar when opened", async () => {
    const { service, calendar } = setup();
    await service.init(tripId);
    await service.sync(tripId, fixture());
    expect(stateOf(service)).toBe("off");
    expect(calendar.calls).toEqual([]);
    expect(calendar.accessPort.requestAccess).not.toHaveBeenCalled();
  });
  it("on enabling, asks for full access once and creates every event with its marker", async () => {
    const { service, calendar } = setup();
    await service.enable(tripId, fixture());
    expect(calendar.accessPort.requestAccess).toHaveBeenCalledExactlyOnceWith("manage");
    expect(stateOf(service)).toBe("synced");
    expect(service.getStatus(tripId)).toMatchObject({ state: "synced", at: "2026-11-10T12:00:00.000Z" });
    expect(calendar.events.size).toBe(5);
    expect(calendar.markers().sort()).toEqual([`activity-${itineraryId(8)}`, `activity-${itineraryId(9)}`, `day-${itineraryId(4)}`, `transport-${itineraryId(6)}`, `transport-${itineraryId(7)}`]
      .map((key) => `travellier:${key}@${tripId}`).sort());
  });
  it("does not ask again for a permission that is already granted", async () => {
    const { service, calendar } = setup();
    await service.enable(tripId, fixture());
    await service.enable(tripId, fixture());
    expect(calendar.accessPort.requestAccess).toHaveBeenCalledTimes(1);
  });
  it("edits an event in place (same id) when the plan changes and leaves the rest untouched", async () => {
    const { service, calendar } = setup();
    await service.enable(tripId, fixture());
    const ids = [...calendar.events.keys()];
    calendar.calls.length = 0;
    const edited = fixture();
    edited.activities[0]!.title = "Paseo renombrado";
    await service.sync(tripId, edited);
    expect(calendar.calls).toEqual(["update"]);
    expect([...calendar.events.keys()]).toEqual(ids);
    expect(calendar.titles()).toContain("Paseo renombrado");
    expect(stateOf(service)).toBe("synced");
  });
  it("does nothing when nothing changed (idempotent)", async () => {
    const { service, calendar } = setup();
    await service.enable(tripId, fixture());
    calendar.calls.length = 0;
    await service.sync(tripId, fixture());
    expect(calendar.calls).toEqual([]);
  });
  it("removes the event of a deleted activity and keeps the others", async () => {
    const { service, calendar } = setup();
    await service.enable(tripId, fixture());
    const reduced = fixture();
    reduced.activities = reduced.activities.filter((activity) => activity.id !== itineraryId(9));
    await service.sync(tripId, reduced);
    expect(calendar.events.size).toBe(4);
    expect(calendar.markers().some((marker) => marker.includes(itineraryId(9)))).toBe(false);
  });
  it("after a restart (new service, same preferences) updates instead of duplicating", async () => {
    const first = setup();
    await first.service.enable(tripId, fixture());
    const second = setup({ calendar: first.calendar, prefs: first.prefs });
    await second.service.init(tripId);
    expect(second.service.getStatus(tripId).state).not.toBe("off");
    const edited = fixture();
    edited.activities[0]!.title = "Otro";
    await second.service.sync(tripId, edited);
    expect(first.calendar.events.size).toBe(5);
  });
  it("adopts an event found by marker when the reference was lost (reinstall) instead of creating a duplicate", async () => {
    const first = setup();
    await first.service.enable(tripId, fixture());
    const reinstalled = setup({ calendar: first.calendar, prefs: memoryPreferences() });
    await reinstalled.service.enable(tripId, fixture());
    expect(first.calendar.events.size).toBe(5);
    expect(stateOf(reinstalled.service)).toBe("synced");
  });
  it("survives «created, then died before saving the reference»: the next run adopts it by marker", async () => {
    const calendar = fakeCalendar();
    const prefs = memoryPreferences();
    const realStore = createCalendarRefStore(prefs.preferences);
    let dying = true;
    const store: CalendarRefStore = { ...realStore, write: async (account, trip, state) => {
      if (dying && Object.keys(state.deviceRefs).length > 0) throw new Error("process died");
      return realStore.write(account, trip, state);
    } };
    const first = setup({ calendar, prefs, store });
    await first.service.enable(tripId, fixture()).catch(() => undefined);
    expect(calendar.events.size).toBeGreaterThan(0);
    dying = false;
    const second = setup({ calendar, prefs });
    await second.service.enable(tripId, fixture());
    expect(calendar.events.size).toBe(5);
    expect(stateOf(second.service)).toBe("synced");
  });
  it("keeps one event and deletes the extra copies when several carry the same marker", async () => {
    const { service, calendar } = setup();
    await service.enable(tripId, fixture());
    const [[, original]] = [...calendar.events];
    calendar.events.set("dup-1", { ...original! });
    calendar.events.set("dup-2", { ...original! });
    const again = setup({ calendar, prefs: memoryPreferences() });
    await again.service.enable(tripId, fixture());
    expect(calendar.events.size).toBe(5);
  });
  it("without permission it reports denied, never synced, and touches nothing", async () => {
    const { service, calendar } = setup();
    calendar.set("denied", "denied");
    await service.enable(tripId, fixture());
    expect(stateOf(service)).toBe("denied");
    expect(calendar.events.size).toBe(0);
    expect(calendar.calls).toEqual([]);
    await service.sync(tripId, fixture());
    expect(stateOf(service)).not.toBe("synced");
  });
  it("with write-only access (iOS «Add Events Only») it is limited, not synced, and nothing is created", async () => {
    const { service, calendar } = setup();
    calendar.set("denied", "granted");
    await service.enable(tripId, fixture());
    expect(service.getStatus(tripId)).toMatchObject({ state: "denied", limited: true });
    expect(calendar.events.size).toBe(0);
  });
  it("still asking (prompt) is needs-permission, not an error", async () => {
    const { service, calendar } = setup();
    calendar.dialog.grant = false;
    await service.enable(tripId, fixture());
    expect(stateOf(service)).toBe("needs-permission");
  });
  it("a failure on one event does not stop the rest and the result is partial, never synced; the failed key is retried later", async () => {
    const { service, calendar } = setup();
    calendar.failing.set("create", (spec) => spec?.title === "Visita al museo");
    await service.enable(tripId, fixture());
    expect(calendar.events.size).toBe(4);
    expect(service.getStatus(tripId)).toMatchObject({ state: "partial", failed: 1 });
    calendar.failing.clear();
    await service.sync(tripId, fixture());
    expect(stateOf(service)).toBe("synced");
    expect(calendar.events.size).toBe(5);
  });
  it("when every operation fails the state is error", async () => {
    const { service, calendar } = setup();
    calendar.failing.set("create", () => true);
    await service.enable(tripId, fixture());
    expect(stateOf(service)).toBe("error");
    expect(calendar.events.size).toBe(0);
  });
  it("a failed removal keeps its reference and is retried; a missing event counts as already removed", async () => {
    const { service, calendar } = setup();
    await service.enable(tripId, fixture());
    const reduced = fixture();
    reduced.activities = [];
    calendar.failing.set("remove", () => true);
    await service.sync(tripId, reduced);
    expect(stateOf(service)).toBe("partial");
    expect(calendar.events.size).toBe(5 - 0);
    calendar.failing.clear();
    calendar.events.delete([...calendar.events].find(([, event]) => event.notes.includes(`activity-${itineraryId(8)}`))![0]);
    await service.sync(tripId, reduced);
    expect(stateOf(service)).toBe("synced");
    expect(calendar.markers().some((marker) => marker.includes("activity-"))).toBe(false);
  });
  it("an event deleted outside the app is respected while the plan does not change, and comes back with an explicit «add again»", async () => {
    const { service, calendar } = setup();
    await service.enable(tripId, fixture());
    const [firstId] = [...calendar.events.keys()];
    calendar.events.delete(firstId!);
    await service.sync(tripId, fixture());
    expect(calendar.events.size).toBe(4);
    await service.restore(tripId, fixture());
    expect(calendar.events.size).toBe(5);
    expect(stateOf(service)).toBe("synced");
  });
  it("if the plan changes for an event deleted outside the app, it is created again with the new data", async () => {
    const { service, calendar } = setup();
    await service.enable(tripId, fixture());
    for (const id of [...calendar.events.keys()]) calendar.events.delete(id);
    const edited = fixture();
    edited.activities[0]!.title = "Nuevo título";
    await service.sync(tripId, edited);
    expect(calendar.titles()).toEqual(["Nuevo título"]);
  });
  it("respects an event edited outside the app while the plan does not change, and overwrites managed fields when it does", async () => {
    const { service, calendar } = setup();
    await service.enable(tripId, fixture());
    const [id, event] = [...calendar.events].find(([, item]) => item.title === "Paseo por el centro")!;
    calendar.events.set(id, { ...event, title: "Editado por el usuario" });
    await service.sync(tripId, fixture());
    expect(calendar.events.get(id)!.title).toBe("Editado por el usuario");
    const edited = fixture();
    edited.activities[0]!.title = "Paseo v2";
    await service.sync(tripId, edited);
    expect(calendar.events.get(id)!.title).toBe("Paseo v2");
  });
  it("keeps the data of each account apart and does nothing for an account without a valid id", async () => {
    const first = setup();
    await first.service.enable(tripId, fixture());
    first.account.current = "user-2";
    expect(stateOf(first.service)).not.toBe("synced");
    await first.service.init(tripId);
    expect(stateOf(first.service)).toBe("off");
    await first.service.sync(tripId, fixture());
    expect(first.calendar.events.size).toBe(5);
    first.account.current = "user-1";
    await first.service.init(tripId);
    expect(stateOf(first.service)).not.toBe("off");
    first.account.current = null;
    first.calendar.calls.length = 0;
    await first.service.enable(tripId, fixture());
    await first.service.sync(tripId, fixture());
    expect(stateOf(first.service)).toBe("needs-account");
    expect(first.calendar.calls).toEqual([]);
      });
  it("runs one synchronization at a time per Trip and queues one more pass with the latest itinerary", async () => {
    const { service, calendar } = setup();
    await service.enable(tripId, fixture());
    calendar.calls.length = 0;
    let release!: () => void;
    calendar.gate.pause = new Promise<void>((resolve) => { release = resolve; });
    const withNew = fixture();
    withNew.activities.push({ ...withNew.activities[0]!, id: itineraryId(30), title: "Nueva A" });
    const running = service.sync(tripId, withNew);
    await vi.waitFor(() => expect(calendar.calls).toContain("create"));
    const latest = fixture();
    latest.activities.push({ ...latest.activities[0]!, id: itineraryId(30), title: "Nueva A" }, { ...latest.activities[0]!, id: itineraryId(31), title: "Nueva B" });
    const second = service.sync(tripId, latest);
    const third = service.sync(tripId, latest);
    expect(calendar.calls.filter((call) => call === "create")).toHaveLength(1);
    calendar.gate.pause = undefined;
    release();
    await Promise.all([running, second, third]);
    expect(calendar.titles()).toEqual(expect.arrayContaining(["Nueva A", "Nueva B"]));
    expect(calendar.events.size).toBe(7);
    expect(stateOf(service)).toBe("synced");
  });
  it("different Trips do not block each other", async () => {
    const { service, calendar } = setup();
    const other = { ...fixture(), tripId: itineraryId(77) } as TripItineraryResponse;
    await service.enable(tripId, fixture());
    await service.enable(itineraryId(77), other);
    expect(calendar.events.size).toBe(10);
  });
  it("working through a big itinerary is bounded per pass but completes", async () => {
    const { service, calendar } = setup();
    const big = fixture();
    for (let index = 0; index < 120; index += 1) big.activities.push({ ...big.activities[0]!, id: itineraryId(1000 + index), title: `Plan ${index}` });
    await service.enable(tripId, big);
    expect(calendar.events.size).toBe(125);
    expect(stateOf(service)).toBe("synced");
  });
  it("stopping keeps the events and the references; sync no longer runs", async () => {
    const { service, calendar } = setup();
    await service.enable(tripId, fixture());
    await service.disable(tripId);
    expect(stateOf(service)).toBe("off");
    const edited = fixture();
    edited.activities[0]!.title = "x";
    await service.sync(tripId, edited);
    expect(calendar.events.size).toBe(5);
    expect(calendar.titles()).not.toContain("x");
    await service.enable(tripId, edited);
    expect(calendar.events.size).toBe(5);
    expect(calendar.titles()).toContain("x");
  });
  it("«remove from calendar» deletes the events the app created, forgets them and turns sync off", async () => {
    const { service, calendar } = setup();
    await service.enable(tripId, fixture());
    const foreign = { ...[...calendar.events.values()][0]!, notes: "evento ajeno", title: "Ajeno" };
    calendar.events.set("foreign", foreign);
    expect(await service.removeAll(tripId)).toEqual({ removed: 5, failed: 0 });
    expect([...calendar.events.keys()]).toEqual(["foreign"]);
    expect(stateOf(service)).toBe("off");
    await service.sync(tripId, fixture());
    expect(calendar.events.size).toBe(1);
  });
  it("«remove from calendar» with a failure keeps what could not be deleted and reports an error", async () => {
    const { service, calendar } = setup();
    await service.enable(tripId, fixture());
    calendar.failing.set("remove", () => true);
    expect(await service.removeAll(tripId)).toEqual({ removed: 0, failed: 5 });
    expect(stateOf(service)).toBe("error");
    expect(calendar.events.size).toBe(5);
  });
  it("revoked permission in the middle of the run ends as denied, not synced", async () => {
    const { service, calendar } = setup();
    await service.enable(tripId, fixture());
    calendar.set("denied", "denied");
    const edited = fixture();
    edited.activities[0]!.title = "y";
    await service.sync(tripId, edited);
    expect(stateOf(service)).toBe("denied");
  });
  it("a permission revoked by an operation mid-run stops the run and ends as denied, never synced", async () => {
    const { service, calendar } = setup();
    calendar.revokeOnCreate.value = true;
    await service.enable(tripId, fixture());
    expect(stateOf(service)).toBe("denied");
    expect(calendar.calls.filter((call) => call === "create")).toHaveLength(1);
    expect(calendar.events.size).toBe(0);
  });
  it("notifies subscribers of every status change and stops after unsubscribing", async () => {
    const { service } = setup();
    const listener = vi.fn();
    const stop = service.subscribe(listener);
    await service.enable(tripId, fixture());
    expect(listener).toHaveBeenCalled();
    const calls = listener.mock.calls.length;
    stop();
    await service.disable(tripId);
    expect(listener).toHaveBeenCalledTimes(calls);
  });
  it("never logs event content or ids", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => undefined));
    const { service, calendar } = setup();
    calendar.failing.set("create", (spec) => spec?.title === "Visita al museo");
    await service.enable(tripId, fixture());
    await service.removeAll(tripId);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
