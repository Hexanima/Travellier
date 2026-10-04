import { describe, expect, it } from "vitest";
import { formValuesFromTransport, prepareTransportInput } from "./transport-form-state.js";
import type { JourneyTransport, TransportType } from "./trip-journey-api.js";

const buenosAires = "America/Argentina/Buenos_Aires";
const changedZones = ["America/New_York", "Asia/Tokyo"];
const original = (type: TransportType = "bus_local"): JourneyTransport => ({
  id: "507f1f77bcf86cd799439014", tripId: "507f191e810c19729de860ea", destinationId: "507f1f77bcf86cd799439013",
  direction: "outbound", type, departurePlace: "A", arrivalPlace: "B", costPerPerson: null,
  departureAt: "2026-10-04T06:00:00.123Z", arrivalAt: "2026-10-04T08:00:00.456Z",
  details: type === "bus_local" ? { steps: [{ line: "1", fromStop: "A", toStop: "B", estimatedAt: "2026-10-04T07:30:12.345Z" }] }
    : type === "flight" ? { flightNumber: "AR123" } : type === "bus_long" ? { company: "Empresa" } : {},
} as JourneyTransport);
const inZone = (timeZone: string, work: () => void) => {
  const previous = process.env.TZ;
  try { process.env.TZ = timeZone; work(); }
  finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
};

describe("transport form timezone changes while editing", () => {
  const cases = changedZones.flatMap((zone) => (["bus_local", "flight", "bus_long", "car", "other"] as const)
    .map((type) => ({ zone, type })));
  it.each(cases)("preserves confirmed instants for $type after switching to $zone", ({ zone, type }) => inZone(buenosAires, () => {
    const transport = original(type), loaded = formValuesFromTransport(transport);
    process.env.TZ = zone;
    const before = JSON.stringify(loaded);
    expect(prepareTransportInput({ ...loaded, arrivalPlace: "C" }, "outbound", undefined, undefined, transport))
      .toMatchObject({ ok: true, value: { departureAt: transport.departureAt, arrivalAt: transport.arrivalAt, details: transport.details } });
    expect(JSON.stringify(loaded)).toBe(before);
  }));

  const edits = changedZones.flatMap((zone) => (["departureAt", "arrivalAt"] as const).map((field) => ({ zone, field })));
  it.each(edits)("converts only edited $field in the opening zone after switching to $zone", ({ zone, field }) => inZone(buenosAires, () => {
    const transport = original(), loaded = formValuesFromTransport(transport);
    process.env.TZ = zone;
    const untouched = field === "departureAt" ? "arrivalAt" : "departureAt";
    const value = field === "departureAt" ? "2026-10-04T03:30" : "2026-10-04T05:30";
    const expected = field === "departureAt" ? "2026-10-04T06:30:00.000Z" : "2026-10-04T08:30:00.000Z";
    expect(prepareTransportInput({ ...loaded, [field]: value }, "outbound", undefined, undefined, transport))
      .toMatchObject({ ok: true, value: { [field]: expected, [untouched]: transport[untouched], details: transport.details } });
  }));

  it.each(changedZones)("keeps new and reconfirmed clocks in the opening zone across midnight after switching to %s", (zone) => inZone(buenosAires, () => {
    const transport = { ...original(), departureAt: "2026-10-04T02:30:00.123Z", arrivalAt: "2026-10-04T04:00:00.456Z" };
    const legacy = { ...transport, details: { steps: [{ line: "1", fromStop: "A", toStop: "B", estimatedTime: "00:30" }] } } as JourneyTransport;
    const loaded = formValuesFromTransport(legacy);
    process.env.TZ = zone;
    expect(prepareTransportInput(loaded, "outbound", undefined, undefined, legacy)).toMatchObject({ ok: false });
    const confirmed = { ...loaded, legacyTimesConfirmed: true };
    const expected = { ok: true, value: { departureAt: legacy.departureAt, arrivalAt: legacy.arrivalAt,
      details: { steps: [{ estimatedAt: "2026-10-04T03:30:00.000Z" }] } } };
    expect(prepareTransportInput(confirmed, "outbound", undefined, undefined, legacy)).toMatchObject(expected);
    expect(prepareTransportInput({ ...formValuesFromTransport(transport), ...confirmed, requiresTimeConfirmation: false },
      "outbound", undefined, undefined, transport)).toMatchObject(expected);
  }));

  it.each([
    { departureAt: "2026-11-01T05:45:00.000Z", arrivalAt: "2026-11-01T08:00:00.000Z", clock: "01:30", expected: "2026-11-01T06:30:00.000Z" },
    { departureAt: "2026-03-08T08:30:00.000Z", arrivalAt: "2026-03-09T08:00:00.000Z", clock: "02:30", expected: "2026-03-09T06:30:00.000Z" },
  ])("resolves DST in the opening zone after a system zone change: $expected", ({ departureAt, arrivalAt, clock, expected }) => inZone("America/New_York", () => {
    const transport = { ...original(), departureAt, arrivalAt };
    const loaded = formValuesFromTransport(transport);
    process.env.TZ = buenosAires;
    expect(prepareTransportInput({ ...loaded, steps: [{ line: "1", fromStop: "A", toStop: "B", estimatedTime: clock }] },
      "outbound", undefined, undefined, transport)).toMatchObject({ ok: true, value: { details: { steps: [{ estimatedAt: expected }] } } });
  }));

  it("still rejects a clock in a DST gap after changing the system zone", () => inZone("America/New_York", () => {
    const transport = { ...original(), departureAt: "2026-03-08T06:30:00.000Z", arrivalAt: "2026-03-08T08:00:00.000Z" };
    const loaded = formValuesFromTransport(transport);
    process.env.TZ = buenosAires;
    expect(prepareTransportInput({ ...loaded, steps: [{ line: "1", fromStop: "A", toStop: "B", estimatedTime: "02:30" }] },
      "outbound", undefined, undefined, transport)).toMatchObject({ ok: false, errors: { "details.steps[0].estimatedTime": expect.any(String) } });
  }));
});
