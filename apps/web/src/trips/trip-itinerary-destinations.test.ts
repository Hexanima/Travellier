import { describe, expect, it } from "vitest";
import { itineraryFixture, itineraryId } from "./itinerary-test-fixture.js";
import { destinationChoices, destinationForDate } from "./trip-itinerary-destinations.js";
import type { TripItineraryResponse } from "./trip-itinerary-api.js";

type Stop = { id: number; order: number; out?: string; back?: string };
/** Builds an itinerary from stops; days follow the transports: transit out, activity window, transit back. */
function build(stops: Stop[]): TripItineraryResponse {
  const base = itineraryFixture() as TripItineraryResponse;
  const tripId = base.tripId;
  const destinations = stops.map((s) => ({ ...base.destinations[0]!, id: itineraryId(s.id), name: `Destino ${s.id}`, order: s.order }));
  const transports: TripItineraryResponse["transports"] = [];
  const days: TripItineraryResponse["days"] = [];
  let n = 100;
  for (const s of stops) {
    const destinationId = itineraryId(s.id);
    if (s.out) {
      transports.push({ ...base.transports[0]!, id: itineraryId(n++), destinationId, direction: "outbound", departureAt: new Date(Date.parse(s.out) - 3600_000).toISOString(), arrivalAt: s.out });
    }
    if (s.back) {
      transports.push({ ...base.transports[1]!, id: itineraryId(n++), destinationId, direction: "return", departureAt: s.back, arrivalAt: new Date(Date.parse(s.back) + 3600_000).toISOString() });
    }
    if (s.out && s.back && Date.parse(s.out) <= Date.parse(s.back)) {
      days.push({ ...base.days[1]!, id: itineraryId(n++), destinationId, type: "activity", startsAt: s.out, endsAt: s.back, order: 1, items: [] });
    }
  }
  return { ...base, tripId, destinations, transports, days, activities: [], posts: [], expenses: [] } as TripItineraryResponse;
}
const A = { id: 2, order: 1, out: "2026-09-25T10:00:00.000Z", back: "2026-09-28T18:00:00.000Z" };
const B = { id: 3, order: 2, out: "2026-09-28T19:00:00.000Z", back: "2026-10-01T12:00:00.000Z" };

describe("destinationChoices", () => {
  it("orders by order even when the array comes reversed and derives local limits", () => {
    const value = build([B, A]);
    value.destinations.reverse();
    const choices = destinationChoices(value, "UTC");
    expect(choices.map((c) => c.id)).toEqual([itineraryId(2), itineraryId(3)]);
    expect(choices[0]).toMatchObject({ order: 1, status: "complete", firstDay: "2026-09-25", lastDay: "2026-09-28", arrivalAt: A.out, departureAt: A.back });
  });
  it("uses the local zone for the limits", () => {
    const value = build([{ id: 2, order: 1, out: "2026-09-25T02:00:00.000Z", back: "2026-09-27T02:00:00.000Z" }]);
    expect(destinationChoices(value, "UTC")[0]).toMatchObject({ firstDay: "2026-09-25", lastDay: "2026-09-27" });
    expect(destinationChoices(value, "America/Argentina/Buenos_Aires")[0]).toMatchObject({ firstDay: "2026-09-24", lastDay: "2026-09-26" });
  });
  it("arrival and departure on the same local day", () => {
    const value = build([{ id: 2, order: 1, out: "2026-09-25T10:00:00.000Z", back: "2026-09-25T18:00:00.000Z" }]);
    const [choice] = destinationChoices(value, "UTC");
    expect(choice).toMatchObject({ status: "complete", firstDay: "2026-09-25", lastDay: "2026-09-25" });
  });
  it("does not round milliseconds", () => {
    const value = build([{ id: 2, order: 1, out: "2026-09-25T10:00:00.123Z", back: "2026-09-25T10:00:00.456Z" }]);
    expect(destinationChoices(value, "UTC")[0]).toMatchObject({ arrivalAt: "2026-09-25T10:00:00.123Z", departureAt: "2026-09-25T10:00:00.456Z", status: "complete" });
  });
  it("marks missing transports and never invents dates", () => {
    const value = build([{ id: 2, order: 1 }, { id: 3, order: 2, out: B.out }, { id: 4, order: 3, back: B.back }, { id: 5, order: 4, out: B.back, back: B.out }]);
    const choices = destinationChoices(value, "UTC");
    expect(choices.map((c) => c.status)).toEqual(["missing-both", "missing-return", "missing-outbound", "inconsistent"]);
    for (const c of choices) expect([c.firstDay, c.lastDay]).toEqual([null, null]);
    expect(choices[1]).toMatchObject({ arrivalAt: B.out, departureAt: null });
    expect(choices[2]).toMatchObject({ arrivalAt: null, departureAt: B.back });
  });
});

describe("destinationForDate", () => {
  const choices = destinationChoices(build([A, B]), "UTC"); // both on 2026-09-28
  const seg = (id: number) => [{ destinationId: itineraryId(id) }];
  it("shared day: the preferred one wins, else the first by order", () => {
    expect(destinationForDate(choices, "2026-09-28", itineraryId(2), seg(3))).toBe(itineraryId(2));
    expect(destinationForDate(choices, "2026-09-28", itineraryId(3), seg(2))).toBe(itineraryId(3));
    expect(destinationForDate(choices, "2026-09-28", undefined, seg(3))).toBe(itineraryId(2));
  });
  it("a preferred destination out of range yields the one that contains the date", () => {
    expect(destinationForDate(choices, "2026-09-26", itineraryId(3), seg(2))).toBe(itineraryId(2));
    expect(destinationForDate(choices, "2026-09-30", itineraryId(2), seg(3))).toBe(itineraryId(3));
  });
  it("a day no complete destination contains falls back to its first segment, else undefined", () => {
    expect(destinationForDate(choices, "2026-12-01", undefined, seg(3))).toBe(itineraryId(3));
    expect(destinationForDate(choices, "2026-12-01", undefined, [])).toBeUndefined();
  });
  it("an incomplete preferred destination is ignored", () => {
    const partial = destinationChoices(build([A, { id: 3, order: 2, out: B.out }]), "UTC");
    expect(destinationForDate(partial, "2026-09-28", itineraryId(3), seg(2))).toBe(itineraryId(2));
  });
});
