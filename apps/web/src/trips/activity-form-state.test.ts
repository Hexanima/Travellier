import { describe, expect, it } from "vitest";
import { itineraryFixture } from "./itinerary-test-fixture.js";
import type { TripItineraryResponse } from "./trip-itinerary-api.js";
import { initialActivityValues, prepareActivityInput, type ActivityFormContext } from "./activity-form-state.js";

const context = (timeZone = "America/Argentina/Buenos_Aires"): ActivityFormContext => {
  const itinerary = itineraryFixture() as TripItineraryResponse;
  const day = itinerary.days[1];
  return { tripId: itinerary.tripId, days: itinerary.days, timeZone,
    selection: { date: "2026-09-25", destinationId: day.destinationId, sourceDayIds: [day.id], startsAt: day.startsAt, endsAt: day.endsAt } };
};
const values = () => ({ mode: "planned" as const, title: "  Paseo  ", description: "", mapsUrl: "", date: "2026-09-25", time: "09:00" });
const invalid = (change: Partial<ReturnType<typeof values>>, field: string) => {
  expect(prepareActivityInput({ ...values(), ...change }, context())).toMatchObject({ ok: false, errors: { [field]: expect.any(String) } });
};

describe("activity form state", () => {
  it("starts a planned activity on the selected local date without inventing a time", () => {
    expect(initialActivityValues(context(), "planned", new Date("2026-10-04T12:00:00Z")))
      .toMatchObject({ mode: "planned", date: "2026-09-25", time: "", title: "", description: "", mapsUrl: "" });
  });
  it("prefills a spontaneous activity with the actual local occurrence time", () => {
    const value = initialActivityValues(context(), "spontaneous", new Date("2026-09-25T12:34:56.789Z"));
    expect(value).toMatchObject({ mode: "spontaneous", date: "2026-09-25", time: "09:34" });
    expect(prepareActivityInput({ ...value, title: "Ahora" }, context())).toMatchObject({ ok: true, value: { scheduledAt: "2026-09-25T12:34:56.789Z" } });
  });
  it("does not silently move a spontaneous timestamp into the selected day", () => {
    const value = initialActivityValues(context(), "spontaneous", new Date("2026-10-04T12:00:00Z"));
    expect(value.date).toBe("2026-10-04");
    expect(prepareActivityInput({ ...value, title: "Ahora" }, context()).ok).toBe(false);
  });
  it("prepares a canonical day ID and UTC instant while clearing empty optional fields", () => {
    expect(prepareActivityInput(values(), context())).toEqual({ ok: true, value: {
      dayId: context().days[1].id, title: "Paseo", scheduledAt: "2026-09-25T12:00:00.000Z", description: null, mapsUrl: null,
    } });
  });
  it.each([
    [{ title: " " }, "title"], [{ date: "" }, "date"], [{ time: "" }, "time"],
    [{ date: "2026-02-30" }, "scheduledAt"], [{ time: "25:00" }, "scheduledAt"],
    [{ time: "07:00" }, "scheduledAt"], [{ time: "06:59" }, "scheduledAt"], [{ time: "15:01" }, "scheduledAt"],
    [{ date: "2026-09-26" }, "scheduledAt"],
  ])("rejects invalid input %j", (change, field) => invalid(change, field));
  it("retains optional content", () => {
    expect(prepareActivityInput({ ...values(), description: "En el centro", mapsUrl: "https://maps.app.goo.gl/example" }, context()))
      .toMatchObject({ ok: true, value: { description: "En el centro", mapsUrl: "https://maps.app.goo.gl/example" } });
  });
  it("preserves UTC seconds and milliseconds when editing another field", () => {
    const existing = (itineraryFixture() as TripItineraryResponse).activities[0];
    const value = initialActivityValues(context(), "planned", new Date(), existing);
    expect(value.time).toBe("09:00");
    expect(prepareActivityInput({ ...value, title: "Nuevo" }, context()))
      .toMatchObject({ ok: true, value: { scheduledAt: existing.scheduledAt, dayId: existing.dayId } });
    expect(prepareActivityInput({ ...value, time: "09:30" }, context()))
      .toMatchObject({ ok: true, value: { scheduledAt: "2026-09-25T12:30:00.000Z" } });
  });
  it("resolves a local band merged from multiple canonical UTC slices", () => {
    const ctx = context();
    ctx.days[1].endsAt = "2026-09-25T14:00:00.000Z";
    const next = { ...ctx.days[1], id: "000000000000000000000099", startsAt: ctx.days[1].endsAt, endsAt: "2026-09-25T18:00:00.789Z" };
    ctx.days.push(next); ctx.selection.sourceDayIds.push(next.id);
    expect(prepareActivityInput({ ...values(), time: "11:00" }, ctx)).toMatchObject({ ok: true, value: { dayId: next.id } });
  });
  it("accepts the exact final departure instant but rejects even a millisecond after it", () => {
    const ctx = context();
    const value = { ...values(), time: "15:00", originalScheduledAt: ctx.days[1].endsAt! };
    expect(prepareActivityInput(value, ctx).ok).toBe(true);
    expect(prepareActivityInput({ ...value, originalScheduledAt: "2026-09-25T18:00:00.790Z" }, ctx).ok).toBe(false);
  });
  it.each(["transit_out", "transit_return", "arrival"] as const)("rejects %s as a creation day", (type) => {
    const ctx = context(); ctx.days[1].type = type;
    expect(prepareActivityInput(values(), ctx).ok).toBe(false);
  });
  it("rejects stale, foreign Trip and foreign destination selections", () => {
    for (const field of ["id", "tripId", "destinationId"] as const) {
      const ctx = context(); ctx.days[1][field] = "000000000000000000000099";
      expect(prepareActivityInput(values(), ctx).ok).toBe(false);
    }
  });
  it("rejects a nonexistent local clock during a DST jump", () => {
    const ctx = context("America/New_York"); ctx.selection.date = "2026-03-08";
    expect(prepareActivityInput({ ...values(), date: "2026-03-08", time: "02:30" }, ctx))
      .toMatchObject({ ok: false, errors: { scheduledAt: expect.any(String) } });
  });
});
