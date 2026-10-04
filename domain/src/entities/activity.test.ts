import { describe, expect, it } from "vitest";
import * as domain from "../index.js";
import type { ItineraryDay } from "./itinerary-day.js";

const id = (number: number) => {
  const parsed = domain.createObjectId(number.toString(16).padStart(24, "0"));
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const tripId = id(1), dayId = id(2);
const day: ItineraryDay = {
  id: dayId, tripId, destinationId: id(3), type: "activity", order: 1,
  date: new Date("2026-09-25T00:00:00Z"),
  startsAt: new Date("2026-09-25T10:00:00.123Z"), endsAt: new Date("2026-09-25T18:00:00.789Z"),
};
const context = { trip: { id: tripId, votingEnabled: false }, days: [day] };
const input = () => ({
  id: id(4), tripId, dayId, title: "Paseo por Córdoba",
  scheduledAt: new Date("2026-09-25T12:00:00.456Z"),
  createdBy: id(5), createdAt: new Date("2026-09-24T12:00:00.789Z"),
});
const issue = (field: string, code: string) => ({
  ok: false, error: { tag: "ValidationError", issues: [{ field, code }] },
});

describe("createActivity", () => {
  it("creates a confirmed planned activity when voting is disabled", () => {
    const payload = input();
    expect(domain.createActivity(payload, context)).toEqual({
      ok: true, value: { ...payload, description: null, mapsUrl: null, status: "confirmed" },
    });
  });

  it("creates a proposal when the Trip enables voting", () => {
    expect(domain.createActivity(input(), { ...context, trip: { ...context.trip, votingEnabled: true } }))
      .toMatchObject({ ok: true, value: { status: "proposed" } });
  });

  it.each([false, true])("derives status from the Trip despite extra caller fields: voting=%s", (votingEnabled) => {
    expect(domain.createActivity({ ...input(), status: "voting", votingEnabled: !votingEnabled } as never,
      { ...context, trip: { ...context.trip, votingEnabled } }))
      .toEqual({ ok: true, value: { ...input(), description: null, mapsUrl: null,
        status: votingEnabled ? "proposed" : "confirmed" } });
  });

  it("preserves description and Maps location", () => {
    const payload = { ...input(), description: "Recorrido por el centro", mapsUrl: "https://maps.app.goo.gl/example" };
    expect(domain.createActivity(payload, context))
      .toEqual({ ok: true, value: { ...payload, status: "confirmed" } });
  });

  it("accepts explicit null optional fields", () => {
    expect(domain.createActivity({ ...input(), description: null, mapsUrl: null }, context))
      .toMatchObject({ ok: true, value: { description: null, mapsUrl: null } });
  });

  it.each(["", "  ", undefined, null, 42])("requires a nonempty title: %s", (title) => {
    expect(domain.createActivity({ ...input(), title } as never, context)).toMatchObject(issue("title", "required"));
  });

  it.each(["description", "mapsUrl"] as const)("rejects nontext %s", (field) => {
    expect(domain.createActivity({ ...input(), [field]: 42 } as never, context)).toMatchObject(issue(field, "invalid"));
  });

  it.each([undefined, null, new Date(Number.NaN), "2026-09-24T12:00:00Z"])("rejects invalid createdAt: %s", (createdAt) => {
    expect(domain.createActivity({ ...input(), createdAt } as never, context)).toMatchObject(issue("createdAt", "invalid"));
  });

  it("rejects a Trip context that does not match the activity", () => {
    expect(domain.createActivity(input(), { ...context, trip: { ...context.trip, id: id(9) } }))
      .toMatchObject(issue("tripId", "mismatch"));
  });

  it("rejects an invalid Trip voting configuration", () => {
    expect(domain.createActivity(input(), { ...context, trip: { ...context.trip, votingEnabled: "false" } } as never))
      .toMatchObject(issue("votingEnabled", "invalid"));
  });

  it.each([undefined, null])("requires scheduledAt without substituting createdAt: %s", (scheduledAt) => {
    expect(domain.createActivity({ ...input(), scheduledAt } as never, context))
      .toMatchObject(issue("scheduledAt", "required"));
  });

  it("rejects an invalid scheduledAt", () => {
    expect(domain.createActivity({ ...input(), scheduledAt: new Date(Number.NaN) }, context))
      .toMatchObject(issue("scheduledAt", "invalid"));
  });

  it("rejects a day of another Trip", () => {
    expect(domain.createActivity(input(), { ...context, days: [{ ...day, tripId: id(9) }] }))
      .toMatchObject(issue("dayId", "mismatch"));
  });

  it("rejects an unknown day", () => {
    expect(domain.createActivity({ ...input(), dayId: id(9) }, context)).toMatchObject(issue("dayId", "not_found"));
  });

  it("rejects transit slices", () => {
    expect(domain.createActivity(input(), { ...context, days: [{ ...day, type: "transit_out" }] }))
      .toMatchObject(issue("dayId", "invalid"));
  });

  it("rejects an instant outside the selected slice", () => {
    expect(domain.createActivity({ ...input(), scheduledAt: new Date(day.startsAt.getTime() - 1) }, context))
      .toMatchObject(issue("scheduledAt", "outside_window"));
  });

  it("preserves the occurrence time of a spontaneous activity recorded after the Trip", () => {
    const payload = { ...input(), createdAt: new Date("2026-10-04T22:30:00Z") };
    expect(domain.createActivity(payload, context)).toMatchObject({ ok: true, value: {
      scheduledAt: new Date("2026-09-25T12:00:00.456Z"), createdAt: payload.createdAt,
    } });
  });

  it("preserves UTC instants and milliseconds supplied with a local offset", () => {
    expect(domain.createActivity({ ...input(), scheduledAt: new Date("2026-09-25T09:00:00.456-03:00") }, context))
      .toMatchObject({ ok: true, value: { scheduledAt: new Date("2026-09-25T12:00:00.456Z") } });
  });

  it("returns independent dates without mutating inputs or itinerary context", () => {
    const payload = Object.freeze(input());
    const snapshot = structuredClone({ payload, context });
    const first = domain.createActivity(payload, context);
    const second = domain.createActivity(payload, context);
    expect(first?.ok).toBe(true);
    expect(second?.ok).toBe(true);
    if (!first?.ok || !second?.ok) return;
    first.value.scheduledAt.setTime(0);
    first.value.createdAt.setTime(0);
    expect({ payload, context }).toEqual(snapshot);
    expect(second.value.scheduledAt).toEqual(snapshot.payload.scheduledAt);
    expect(second.value.createdAt).toEqual(snapshot.payload.createdAt);
  });
});
