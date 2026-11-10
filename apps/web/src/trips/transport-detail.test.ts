import { describe, expect, it } from "vitest";
import { itineraryFixture, itineraryId, linkPost } from "./itinerary-test-fixture.js";
import type { ItineraryPostResponse, TripItineraryResponse } from "./trip-itinerary-api.js";
import { readTransportParams, transportDaySlices, transportMemories, transportSteps } from "./transport-detail.js";
import { readActivityParams } from "./activity-memories.js";

const id = (n: number) => itineraryId(n);
const BA = "America/Argentina/Buenos_Aires";

describe("readTransportParams", () => {
  it("reads a valid id and tab", () => {
    expect(readTransportParams(`?transport=${id(6)}&tab=photos`)).toEqual({ transportId: id(6), tab: "photos" });
    expect(readTransportParams(`?transport=${id(6)}`)).toEqual({ transportId: id(6), tab: "memories" });
    expect(readTransportParams(`?transport=${id(6)}&tab=otra`)).toEqual({ transportId: id(6), tab: "memories" });
  });
  it.each(["", "?transport=", "?transport=abc", `?transport=${id(6).toUpperCase().replace(/0/g, "A")}`, `?transport=${id(6)}0`, `?transport=${id(6).slice(1)}`, "?transport=../x"])(
    "drops an invalid id (%s)", (search) => {
      expect(readTransportParams(search).transportId).toBeUndefined();
    });
  it("opens nothing when an activity coexists, and the activity reader ignores a coexisting transport", () => {
    expect(readTransportParams(`?transport=${id(6)}&activity=${id(8)}`).transportId).toBeUndefined();
    expect(readActivityParams(`?transport=${id(6)}&activity=${id(8)}`).activityId).toBeUndefined();
    expect(readActivityParams(`?activity=${id(8)}`).activityId).toBe(id(8));
  });
  it("an invalid activity does not block a valid transport", () => {
    expect(readTransportParams(`?transport=${id(6)}&activity=zzz`).transportId).toBeUndefined();
  });
});

const post = (n: number, createdAt: string, links: Parameters<typeof linkPost>[1]): ItineraryPostResponse => {
  const base = (itineraryFixture() as TripItineraryResponse).posts[0]!;
  return linkPost({ ...base, id: id(n), createdAt, expense: null } as ItineraryPostResponse, links);
};

describe("transportMemories", () => {
  const T = id(6), OTHER = id(7);
  it("keeps posts rooted in the transport, descendants and unplaced included, once each, newest first", () => {
    const direct = post(30, "2026-09-25T09:00:00.000Z", { transportId: T });
    const child = post(31, "2026-09-25T11:00:00.000Z", { parentPostId: direct.id, rootPostId: direct.id, rootTransportId: T });
    const unplaced = post(32, "2026-09-25T10:00:00.000Z", { transportId: T });
    const other = post(33, "2026-09-25T12:00:00.000Z", { transportId: OTHER });
    const independent = post(34, "2026-09-25T13:00:00.000Z", {});
    const result = transportMemories([direct, child, other, independent], [unplaced, direct], T);
    expect(result.map((item) => item.id)).toEqual([child.id, unplaced.id, direct.id]);
  });
  it("includes a post linked to an activity and the transport, and one published outside the trip dates", () => {
    const both = post(35, "2020-01-01T00:00:00.000Z", { activityId: id(8), transportId: T });
    expect(both.context.placement).toBe("activity");
    expect(transportMemories([both], [], T).map((item) => item.id)).toEqual([both.id]);
  });
  it("is empty when nothing belongs to it", () => {
    expect(transportMemories([], [], T)).toEqual([]);
  });
});

const spanning = (departureAt: string, arrivalAt: string, dayStart = departureAt, dayEnd = arrivalAt) => {
  const itinerary = itineraryFixture() as TripItineraryResponse;
  itinerary.posts = []; itinerary.unplacedPosts = []; itinerary.activities = [];
  itinerary.days = [{ ...itinerary.days[0]!, startsAt: dayStart, endsAt: dayEnd, items: [{ kind: "transport", id: id(6), at: departureAt }] }];
  itinerary.transports = [{ ...itinerary.transports[0]!, departureAt, arrivalAt }];
  return itinerary;
};

describe("transportDaySlices", () => {
  it.each(["UTC", BA])("splits a transport crossing midnight into departure and arrival days in %s without inventing hours", (timeZone) => {
    const slices = transportDaySlices(spanning("2026-09-25T22:30:00.123Z", "2026-09-26T05:15:00.456Z"), id(6), timeZone);
    if (timeZone === "UTC") {
      expect(slices).toEqual([
        { date: "2026-09-25", kind: "Salida", startsAt: "2026-09-25T22:30:00.123Z", endsAt: null },
        { date: "2026-09-26", kind: "Llegada", startsAt: null, endsAt: "2026-09-26T05:15:00.456Z" },
      ]);
    } else {
      // 19:30 -> 02:15 local: still two local days (departure 25, arrival 26)
      expect(slices.map((slice) => [slice.date, slice.kind])).toEqual([["2026-09-25", "Salida"], ["2026-09-26", "Llegada"]]);
      expect(slices[0]!.startsAt).toBe("2026-09-25T22:30:00.123Z");
      expect(slices[1]!.endsAt).toBe("2026-09-26T05:15:00.456Z");
    }
  });
  it("labels three or more days, with intermediate days in transit and no hours", () => {
    const slices = transportDaySlices(spanning("2026-09-25T10:00:00.000Z", "2026-09-28T09:00:00.000Z"), id(6), "UTC");
    expect(slices.map((slice) => [slice.date, slice.kind, slice.startsAt, slice.endsAt])).toEqual([
      ["2026-09-25", "Salida", "2026-09-25T10:00:00.000Z", null],
      ["2026-09-26", "En tránsito", null, null],
      ["2026-09-27", "En tránsito", null, null],
      ["2026-09-28", "Llegada", null, "2026-09-28T09:00:00.000Z"],
    ]);
  });
  it("a transport inside one local day is Salida y llegada, also with departure equal to arrival", () => {
    const one = transportDaySlices(spanning("2026-09-25T08:00:00.000Z", "2026-09-25T10:00:00.000Z"), id(6), "UTC");
    expect(one).toEqual([{ date: "2026-09-25", kind: "Salida y llegada", startsAt: "2026-09-25T08:00:00.000Z", endsAt: "2026-09-25T10:00:00.000Z" }]);
    const equal = transportDaySlices(spanning("2026-09-25T08:00:00.000Z", "2026-09-25T08:00:00.000Z", "2026-09-25T08:00:00.000Z", "2026-09-25T09:00:00.000Z"), id(6), "UTC");
    expect(equal.map((slice) => slice.kind)).toEqual(["Salida y llegada"]);
  });
  it("handles 23 and 25 hour days (America/New_York)", () => {
    const spring = transportDaySlices(spanning("2026-03-07T20:00:00.000Z", "2026-03-09T20:00:00.000Z"), id(6), "America/New_York");
    expect(spring.map((slice) => [slice.date, slice.kind])).toEqual([["2026-03-07", "Salida"], ["2026-03-08", "En tránsito"], ["2026-03-09", "Llegada"]]);
    const fall = transportDaySlices(spanning("2026-10-31T20:00:00.000Z", "2026-11-02T20:00:00.000Z"), id(6), "America/New_York");
    expect(fall.map((slice) => [slice.date, slice.kind])).toEqual([["2026-10-31", "Salida"], ["2026-11-01", "En tránsito"], ["2026-11-02", "Llegada"]]);
  });
  it("is empty for an unknown transport", () => {
    expect(transportDaySlices(spanning("2026-09-25T08:00:00.000Z", "2026-09-25T10:00:00.000Z"), id(99), "UTC")).toEqual([]);
  });
});

describe("transportSteps", () => {
  const bus = (steps: unknown[]) => ({ ...(itineraryFixture() as TripItineraryResponse).transports[0]!, type: "bus_local", details: { steps } }) as unknown as TripItineraryResponse["transports"][number];
  it("formats an instant in the trip zone, a legacy clock as is and an absent time as no schedule", () => {
    const steps = transportSteps(bus([
      { line: "60", fromStop: "A", toStop: "B", estimatedAt: "2026-09-25T22:30:00.123Z" },
      { line: "29", fromStop: "B", toStop: "C", estimatedTime: "07:45" },
      { line: "5", fromStop: "C", toStop: "D" },
    ]), BA);
    expect(steps[0]).toMatchObject({ line: "60", fromStop: "A", toStop: "B", iso: "2026-09-25T22:30:00.123Z", clock: "19:30", note: null });
    expect(steps[1]).toMatchObject({ iso: null, clock: "07:45", note: "Sin fecha ni zona horaria" });
    expect(steps[2]).toMatchObject({ iso: null, clock: "Sin horario", note: null });
    expect(JSON.stringify(steps)).not.toContain("Invalid");
  });
  it("is empty for transports that are not local buses", () => {
    expect(transportSteps((itineraryFixture() as TripItineraryResponse).transports[0]!, "UTC")).toEqual([]);
  });
});
