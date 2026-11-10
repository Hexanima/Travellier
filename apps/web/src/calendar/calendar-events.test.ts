import { describe, expect, it } from "vitest";
import { itineraryFixture, itineraryId } from "../trips/itinerary-test-fixture.js";
import type { TripItineraryResponse } from "../trips/trip-itinerary-api.js";
import { buildCalendarEvents } from "./calendar-events.js";

const fixture = () => itineraryFixture() as TripItineraryResponse;
const withActivity = (patch: Record<string, unknown>, n = 8) => {
  const value = fixture();
  Object.assign(value.activities.find((activity) => activity.id === itineraryId(n))!, patch);
  return value;
};
const find = (events: ReturnType<typeof buildCalendarEvents>, key: string) => events.find((event) => event.key === key)!;

describe("buildCalendarEvents", () => {
  it("keys every event as <kind>-<id> (the ICS UID without the domain) in a stable order", () => {
    const events = buildCalendarEvents(fixture());
    expect(events.map((event) => event.key)).toEqual([
      `transport-${itineraryId(6)}`, `day-${itineraryId(4)}`, `activity-${itineraryId(8)}`, `activity-${itineraryId(9)}`, `transport-${itineraryId(7)}`,
    ]);
    expect(buildCalendarEvents(fixture()).map((event) => event.key)).toEqual(events.map((event) => event.key));
  });
  it("has an end only when a real duration exists; it is never invented", () => {
    const events = buildCalendarEvents(fixture());
    expect(find(events, `activity-${itineraryId(8)}`).end).toBeNull();
    const timed = buildCalendarEvents(withActivity({ durationMinutes: 90 }));
    expect(find(timed, `activity-${itineraryId(8)}`).end?.toISOString()).toBe("2026-09-25T13:30:00.123Z");
    expect(find(events, `transport-${itineraryId(6)}`).end?.toISOString()).toBe("2026-09-25T10:00:00.123Z");
  });
  it("takes the place of an activity from its maps link and leaves it out for an invalid one", () => {
    const placed = buildCalendarEvents(withActivity({ mapsUrl: "https://www.google.com/maps/place/Plaza+San+Mart%C3%ADn/@-31.42,-64.18,17z" }));
    expect(find(placed, `activity-${itineraryId(8)}`)).toMatchObject({ location: "Plaza San Martín" });
    expect(find(placed, `activity-${itineraryId(8)}`).url).toMatch(/^https:\/\//);
    const none = buildCalendarEvents(withActivity({ mapsUrl: "no es un enlace" }));
    expect(find(none, `activity-${itineraryId(8)}`).location).toBeUndefined();
    expect(find(none, `activity-${itineraryId(8)}`).url).toBeUndefined();
  });
  it("makes bands only for activity days (transit days are the transports themselves)", () => {
    const keys = buildCalendarEvents(fixture()).map((event) => event.key);
    expect(keys.filter((key) => key.startsWith("day-"))).toEqual([`day-${itineraryId(4)}`]);
  });
});
