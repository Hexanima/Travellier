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
const values = () => ({ title: "  Paseo  ", description: "", mapsUrl: "", date: "2026-09-25", time: "09:00" });
const reschedulingContext = (timeZone?: string): ActivityFormContext => {
  const ctx = context(timeZone);
  ctx.days[1].endsAt = "2026-09-26T00:00:00.000Z";
  ctx.selection.endsAt = ctx.days[1].endsAt;
  ctx.days.push({ ...ctx.days[1], id: "000000000000000000000099", date: "2026-09-26T00:00:00.000Z",
    startsAt: ctx.days[1].endsAt, endsAt: "2026-09-26T18:00:00.000Z", items: [] });
  return ctx;
};
const invalid = (change: Partial<ReturnType<typeof values>>, field: string) => {
  expect(prepareActivityInput({ ...values(), ...change }, context())).toMatchObject({ ok: false, errors: { [field]: expect.any(String) } });
};

describe("activity form state", () => {
  it("starts a planned activity on the selected local date without inventing a time", () => {
    const initial = initialActivityValues(context());
    expect(initial).toMatchObject({ date: "2026-09-25", time: "", title: "", description: "", mapsUrl: "" });
    expect(initial).not.toHaveProperty("mode");
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
    const value = initialActivityValues(context(), existing);
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
  it.each([
    ["UTC", "2026-09-25T10:00:00.000Z", "2026-09-26T00:00:00.000Z"],
    ["America/Argentina/Buenos_Aires", "2026-09-26T00:00:00.000Z", "2026-09-26T03:00:00.000Z"],
  ])("accepts final departure at next-day midnight in %s from the previous local band", (timeZone, startsAt, endsAt) => {
    const ctx = context(timeZone);
    Object.assign(ctx.days[1], { date: `${startsAt.slice(0, 10)}T00:00:00.000Z`, startsAt, endsAt });
    Object.assign(ctx.selection, { startsAt, endsAt });
    const value = { ...values(), date: "2026-09-26", time: "00:00" };
    expect(prepareActivityInput(value, ctx)).toMatchObject({ ok: true, value: { dayId: ctx.days[1].id, scheduledAt: endsAt } });
    expect(prepareActivityInput({ ...value, originalScheduledAt: new Date(Date.parse(endsAt) + 1).toISOString() }, ctx).ok).toBe(false);
  });
  it("does not allow next-day creation at an artificial local calendar split", () => {
    const ctx = context();
    Object.assign(ctx.days[1], { date: "2026-09-26T00:00:00.000Z", startsAt: "2026-09-26T00:00:00.000Z", endsAt: "2026-09-26T10:00:00.000Z" });
    Object.assign(ctx.selection, { startsAt: ctx.days[1].startsAt, endsAt: "2026-09-26T03:00:00.000Z" });
    expect(prepareActivityInput({ ...values(), date: "2026-09-26", time: "00:00" }, ctx).ok).toBe(false);
  });
  it("does not claim midnight owned by a following canonical activity slice", () => {
    const ctx = context("UTC"), endsAt = "2026-09-26T00:00:00.000Z";
    ctx.days[1].endsAt = ctx.selection.endsAt = endsAt;
    ctx.days.push({ ...ctx.days[1], id: "000000000000000000000099", date: endsAt, startsAt: endsAt, endsAt: "2026-09-26T10:00:00.000Z" });
    expect(prepareActivityInput({ ...values(), date: "2026-09-26", time: "00:00" }, ctx).ok).toBe(false);
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
  it.each([
    ["05:00", "06:00", "05:30"],
    ["06:00", "07:00", "06:30"],
    ["05:45", "06:45", "06:30"],
    ["05:00", "07:00", "05:30"],
  ])("resolves a repeated 01:30 within the selected %s–%s UTC window", (start, end, expected) => {
    const ctx = context("America/New_York");
    const iso = (time: string) => `2026-11-01T${time}:00.000Z`;
    Object.assign(ctx.days[1], { date: iso("00:00"), startsAt: iso(start), endsAt: iso(end) });
    Object.assign(ctx.selection, { date: "2026-11-01", startsAt: iso(start), endsAt: iso(end) });
    expect(prepareActivityInput({ ...values(), date: ctx.selection.date, time: "01:30" }, ctx))
      .toMatchObject({ ok: true, value: { dayId: ctx.days[1].id, scheduledAt: iso(expected) } });
  });
  it("rejects a repeated clock when neither occurrence is in the selected window", () => {
    const ctx = context("America/New_York");
    Object.assign(ctx.days[1], { startsAt: "2026-11-01T06:30:00.001Z", endsAt: "2026-11-01T07:00:00.000Z" });
    Object.assign(ctx.selection, { date: "2026-11-01", startsAt: ctx.days[1].startsAt, endsAt: ctx.days[1].endsAt });
    expect(prepareActivityInput({ ...values(), date: ctx.selection.date, time: "01:30" }, ctx).ok).toBe(false);
  });
  it("preserves the second occurrence exactly and never substitutes an unchanged timestamp", () => {
    const ctx = context("America/New_York");
    Object.assign(ctx.days[1], { startsAt: "2026-11-01T05:00:00.000Z", endsAt: "2026-11-01T07:00:00.000Z" });
    Object.assign(ctx.selection, { date: "2026-11-01", startsAt: ctx.days[1].startsAt, endsAt: ctx.days[1].endsAt });
    const value = { ...values(), date: ctx.selection.date, time: "01:30", originalScheduledAt: "2026-11-01T06:30:12.345Z" };
    expect(prepareActivityInput(value, ctx)).toMatchObject({ ok: true, value: { scheduledAt: value.originalScheduledAt } });
    ctx.days[1].endsAt = ctx.selection.endsAt = "2026-11-01T06:00:00.000Z";
    expect(prepareActivityInput(value, ctx).ok).toBe(false);
  });
  it.each([
    ["America/Argentina/Buenos_Aires", "2026-09-26", "09:00", "2026-09-26T12:00:00.000Z"],
    ["America/New_York", "2026-09-25", "22:00", "2026-09-26T02:00:00.000Z"],
    ["Asia/Tokyo", "2026-09-26", "09:00", "2026-09-26T00:00:00.000Z"],
  ])("resolves the new canonical day when editing in %s", (timeZone, date, time, scheduledAt) => {
    const ctx = reschedulingContext(timeZone);
    expect(prepareActivityInput({ ...values(), date, time }, ctx, "edit"))
      .toMatchObject({ ok: true, value: { dayId: ctx.days[3].id, scheduledAt } });
  });
  it("keeps creation scoped to the selected local day and band", () => {
    const ctx = reschedulingContext();
    expect(prepareActivityInput({ ...values(), date: "2026-09-26" }, ctx).ok).toBe(false);
    expect(prepareActivityInput({ ...values(), time: "22:00" }, ctx).ok).toBe(false);
  });
  it.each(["transit", "destination", "trip", "before", "after", "missing"])("rejects a reschedule with %s outside the enabled destination window", (invalid) => {
    const ctx = reschedulingContext(), next = ctx.days[3];
    let date = "2026-09-26", time = "09:00";
    if (invalid === "transit") next.type = "transit_out";
    if (invalid === "destination") next.destinationId = "000000000000000000000088";
    if (invalid === "trip") next.tripId = "000000000000000000000088";
    if (invalid === "before") { next.startsAt = "2026-09-26T12:00:00.001Z"; }
    if (invalid === "after") time = "15:01";
    if (invalid === "missing") date = "2026-09-27";
    expect(prepareActivityInput({ ...values(), date, time }, ctx, "edit").ok).toBe(false);
  });
});
