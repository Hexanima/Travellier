import { describe, expect, it } from "vitest";

import { createObjectId, type ObjectId, type Transport, type TripDestination } from "../../index.js";
import { generateItineraryDays, type GenerateItineraryDaysPayload } from "./generate-itinerary-days.js";

const id = (value: number): ObjectId => {
  const result = createObjectId(value.toString(16).padStart(24, "0"));
  if (!result.ok) throw result.error;
  return result.value;
};
const tripId = id(1);
const destination = (value = 2, order = 1): TripDestination => ({
  id: id(value), tripId, name: `Destination ${order}`, order, createdAt: new Date("2026-09-01T00:00:00Z"),
});
const transport = (value: number, destinationId: ObjectId, direction: Transport["direction"],
  departureAt: string, arrivalAt: string): Transport => ({
  id: id(value), tripId, destinationId, direction, type: "car", departurePlace: "Origin", arrivalPlace: "Destination",
  departureAt: new Date(departureAt), arrivalAt: new Date(arrivalAt), costPerPerson: null, details: {},
});
const day = (destinationId: ObjectId, type: string, date: string, startsAt: string, endsAt: string, order: number) => ({
  tripId, destinationId, type, date: new Date(date), startsAt: new Date(startsAt), endsAt: new Date(endsAt), order,
});
const singleDay = () => [
  transport(3, id(2), "outbound", "2026-09-25T08:00:00Z", "2026-09-25T10:00:00Z"),
  transport(4, id(2), "return", "2026-09-25T18:00:00Z", "2026-09-25T20:00:00Z"),
];
const input = (): GenerateItineraryDaysPayload => ({ tripId, destinations: [destination()], transports: singleDay() });

const expectIssue = async (payload: GenerateItineraryDaysPayload, field: string, code: string) => {
  expect(await generateItineraryDays.execute({}, payload)).toMatchObject({
    ok: false, error: { tag: "ValidationError", issues: [{ field, code }] },
  });
};

describe("generateItineraryDays", () => {
  it("derives transit, activity and return slices on the same calendar date", async () => {
    const result = await generateItineraryDays.execute({}, { tripId, destinations: [destination()], transports: singleDay() });

    expect(result).toEqual({ ok: true, value: [
      day(id(2), "transit_out", "2026-09-25T00:00:00Z", "2026-09-25T08:00:00Z", "2026-09-25T10:00:00Z", 1),
      day(id(2), "activity", "2026-09-25T00:00:00Z", "2026-09-25T10:00:00Z", "2026-09-25T18:00:00Z", 2),
      day(id(2), "transit_return", "2026-09-25T00:00:00Z", "2026-09-25T18:00:00Z", "2026-09-25T20:00:00Z", 3),
    ] });
  });

  it("splits overnight transports and a multi-day activity window at calendar boundaries", async () => {
    const result = await generateItineraryDays.execute({}, { tripId, destinations: [destination()], transports: [
      transport(3, id(2), "outbound", "2026-09-24T20:00:00Z", "2026-09-25T08:00:00Z"),
      transport(4, id(2), "return", "2026-09-27T20:00:00Z", "2026-09-28T08:00:00Z"),
    ] });

    expect(result).toEqual({ ok: true, value: [
      day(id(2), "transit_out", "2026-09-24T00:00:00Z", "2026-09-24T20:00:00Z", "2026-09-25T00:00:00Z", 1),
      day(id(2), "transit_out", "2026-09-25T00:00:00Z", "2026-09-25T00:00:00Z", "2026-09-25T08:00:00Z", 2),
      day(id(2), "activity", "2026-09-25T00:00:00Z", "2026-09-25T08:00:00Z", "2026-09-26T00:00:00Z", 3),
      day(id(2), "activity", "2026-09-26T00:00:00Z", "2026-09-26T00:00:00Z", "2026-09-27T00:00:00Z", 4),
      day(id(2), "activity", "2026-09-27T00:00:00Z", "2026-09-27T00:00:00Z", "2026-09-27T20:00:00Z", 5),
      day(id(2), "transit_return", "2026-09-27T00:00:00Z", "2026-09-27T20:00:00Z", "2026-09-28T00:00:00Z", 6),
      day(id(2), "transit_return", "2026-09-28T00:00:00Z", "2026-09-28T00:00:00Z", "2026-09-28T08:00:00Z", 7),
    ] });
  });

  it("keeps activity windows separate when two destinations share a transfer date", async () => {
    const result = await generateItineraryDays.execute({}, { tripId,
      destinations: [destination(5, 2), destination()], transports: [
        transport(8, id(5), "return", "2026-09-28T09:00:00Z", "2026-09-28T12:00:00Z"),
        transport(4, id(2), "return", "2026-09-26T14:00:00Z", "2026-09-26T17:00:00Z"),
        transport(7, id(5), "outbound", "2026-09-26T14:00:00Z", "2026-09-26T17:00:00Z"),
        transport(3, id(2), "outbound", "2026-09-23T08:00:00Z", "2026-09-23T10:00:00Z"),
      ] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const activity = result.value.filter((value) => value.type === "activity");
    expect(activity[0]?.startsAt).toEqual(new Date("2026-09-23T10:00:00Z"));
    expect(activity.filter((value) => value.destinationId === id(2)).at(-1)?.endsAt)
      .toEqual(new Date("2026-09-26T14:00:00Z"));
    expect(activity.find((value) => value.destinationId === id(5))?.startsAt)
      .toEqual(new Date("2026-09-26T17:00:00Z"));
    expect(activity.at(-1)?.endsAt).toEqual(new Date("2026-09-28T09:00:00Z"));
    expect(activity.some((value) => value.startsAt < new Date("2026-09-26T17:00:00Z") &&
      value.endsAt > new Date("2026-09-26T14:00:00Z"))).toBe(false);
    expect(result.value.map((value) => value.order)).toEqual(result.value.map((_, index) => index + 1));
    expect(result.value.map((value) => value.startsAt.getTime()))
      .toEqual(result.value.map((value) => value.startsAt.getTime()).sort((a, b) => a - b));
  });

  it.each(["departureAt", "arrivalAt"] as const)("rejects an invalid transport %s", async (field) => {
    const payload = input();
    await expectIssue({ ...payload, transports: [{ ...payload.transports[0]!, [field]: new Date(Number.NaN) }] },
      `transports[0].${field}`, "invalid");
  });

  it("rejects a transport whose arrival precedes its departure", async () => {
    const payload = input();
    await expectIssue({ ...payload, transports: [{ ...payload.transports[0]!, arrivalAt: new Date("2026-09-25T07:59:59.999Z") }] },
      "transports[0].arrivalAt", "before_departure");
  });

  it("rejects transport details already rejected by T28", async () => {
    const payload = input();
    await expectIssue({ ...payload, transports: [{ ...payload.transports[0]!, type: "bus_local", details: { steps: [] } }] },
      "transports[0].details.steps", "required");
  });

  it("rejects a destination belonging to another Trip", async () => {
    const payload = input();
    await expectIssue({ ...payload, destinations: [{ ...destination(), tripId: id(9) }] }, "destinations[0].tripId", "mismatch");
  });

  it("rejects a transport belonging to another Trip", async () => {
    const payload = input();
    await expectIssue({ ...payload, transports: [{ ...payload.transports[0]!, tripId: id(9) }] }, "transports[0].tripId", "mismatch");
  });

  it("rejects a transport referencing a destination outside the input", async () => {
    const payload = input();
    await expectIssue({ ...payload, transports: [{ ...payload.transports[0]!, destinationId: id(9) }] },
      "transports[0].destinationId", "not_found");
  });

  it("rejects duplicate destination IDs", async () => {
    await expectIssue({ ...input(), destinations: [destination(), destination(2, 2)] }, "destinations[1].id", "duplicate");
  });

  it("rejects duplicate destination positions", async () => {
    await expectIssue({ ...input(), destinations: [destination(), destination(5, 1)] }, "destinations[1].order", "duplicate");
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects invalid destination order %s", async (order) => {
    await expectIssue({ ...input(), destinations: [destination(2, order)] }, "destinations[0].order", "invalid");
  });

  it("rejects multiple transports with the same destination and direction", async () => {
    const payload = input();
    await expectIssue({ ...payload, transports: [payload.transports[0]!, { ...payload.transports[0]!, id: id(9) }] },
      "transports[1].direction", "duplicate");
  });

  it("rejects a departure from the destination before its arrival", async () => {
    const payload = input();
    await expectIssue({ ...payload, transports: [payload.transports[0]!,
      { ...payload.transports[1]!, departureAt: new Date("2026-09-25T09:59:59.999Z") }] },
      "destinations[0].activityWindow", "before_arrival");
  });

  it("rejects overlapping activity windows in sequential destinations", async () => {
    const payload = input();
    await expectIssue({ ...payload, destinations: [destination(), destination(5, 2)], transports: [
      ...payload.transports,
      transport(7, id(5), "outbound", "2026-09-25T17:00:00Z", "2026-09-25T17:59:59.999Z"),
      transport(8, id(5), "return", "2026-09-26T18:00:00Z", "2026-09-26T20:00:00Z"),
    ] }, "destinations[1].activityWindow", "before_previous_destination");
  });

  it("preserves milliseconds in both activity limits", async () => {
    const payload = input();
    const result = await generateItineraryDays.execute({}, { ...payload, transports: [
      { ...payload.transports[0]!, arrivalAt: new Date("2026-09-25T10:00:01.123Z") },
      { ...payload.transports[1]!, departureAt: new Date("2026-09-25T18:00:02.456Z") },
    ] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.find((value) => value.type === "activity")).toEqual(
      day(id(2), "activity", "2026-09-25T00:00:00Z", "2026-09-25T10:00:01.123Z", "2026-09-25T18:00:02.456Z", 2),
    );
  });

  it("does not mutate inputs and returns independent projections on repeated calls", async () => {
    const payload = input();
    const destinations = Object.freeze([...payload.destinations]);
    const transports = Object.freeze([...payload.transports].reverse().map((value) => Object.freeze(value)));
    const snapshot = transports.map((value) => ({ ...value, departureAt: new Date(value.departureAt), arrivalAt: new Date(value.arrivalAt) }));
    const first = await generateItineraryDays.execute({}, { ...payload, destinations, transports });
    const second = await generateItineraryDays.execute({}, { ...payload, destinations, transports });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value).toHaveLength(3);
    expect(first.value).toEqual(second.value);
    first.value[0]!.startsAt.setTime(0);
    first.value[0]!.endsAt.setTime(0);
    first.value[0]!.date.setTime(0);
    expect(transports).toEqual(snapshot);
    expect(second.value[0]).toEqual(
      day(id(2), "transit_out", "2026-09-25T00:00:00Z", "2026-09-25T08:00:00Z", "2026-09-25T10:00:00Z", 1),
    );
  });

  it("derives the projection from transports rather than caller-supplied itinerary dates", async () => {
    const supplied = { ...input(), itineraryDays: [
      day(id(2), "activity", "2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z", "2026-01-01T02:00:00Z", 99),
    ] };
    const result = await generateItineraryDays.execute({}, supplied);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(3);
    expect(result.value.every((value) => value.date.getTime() === Date.parse("2026-09-25T00:00:00Z"))).toBe(true);
    expect(result.value.every((value) => !("id" in value))).toBe(true);
  });
});
