import { describe, expect, it } from "vitest";
import { formValuesFromTransport, prepareTransportInput } from "./transport-form-state.js";
import type { JourneyTransport } from "./trip-journey-api.js";

const local = (value: string) => new Date(value).toISOString();
const canonical = () => ({
  id: "507f1f77bcf86cd799439014", tripId: "507f191e810c19729de860ea", destinationId: "507f1f77bcf86cd799439013",
  direction: "outbound", type: "bus_local", departurePlace: "A", arrivalPlace: "B", costPerPerson: null,
  departureAt: local("2026-10-03T23:30"), arrivalAt: local("2026-10-04T01:00"),
  details: { steps: [{ line: "1", fromStop: "A", toStop: "B", estimatedAt: local("2026-10-04T00:30") }] },
} as unknown as JourneyTransport);

describe("urban step conversion", () => {
  it("converts local clock controls to UTC with a midnight rollover", () => {
    const input = canonical();
    const values = { ...formValuesFromTransport(input), steps: [
      { line: "1", fromStop: "A", toStop: "B", estimatedTime: "23:45" },
      { line: "2", fromStop: "B", toStop: "C", estimatedTime: "00:30" },
    ] };
    expect(prepareTransportInput(values, "outbound")).toMatchObject({ ok: true, value: { details: { steps: [
      { estimatedAt: local("2026-10-03T23:45") }, { estimatedAt: local("2026-10-04T00:30") },
    ] } } });
  });
  it("retains the saved step instant and precision when editing only a place", () => {
    const input = canonical();
    input.details = { steps: [{ line: "1", fromStop: "A", toStop: "B", estimatedAt: local("2026-10-04T00:30:12.345") }] } as never;
    const values = { ...formValuesFromTransport(input), arrivalPlace: "C" };
    expect(values.steps[0].estimatedTime).toBe("00:30");
    expect(prepareTransportInput(values, "outbound", undefined, undefined, input)).toMatchObject({ ok: true,
      value: { details: input.details } });
  });
  it("does not silently reinterpret a legacy clock when the form is submitted", () => {
    const input = { ...canonical(), details: { steps: [{ line: "1", fromStop: "A", toStop: "B", estimatedTime: "00:30" }] } } as JourneyTransport;
    expect(prepareTransportInput(formValuesFromTransport(input), "outbound", undefined, undefined, input))
      .toMatchObject({ ok: false, errors: { "details.steps": expect.any(String) } });
  });
  it.each(["America/Argentina/Buenos_Aires", "Asia/Tokyo", "America/New_York"])("round-trips the same UTC instant in %s", (timeZone) => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = timeZone;
      const input = canonical();
      input.departureAt = "2026-10-04T03:00:00.000Z";
      input.arrivalAt = "2026-10-04T05:00:00.000Z";
      input.details = { steps: [{ line: "1", fromStop: "A", toStop: "B", estimatedAt: "2026-10-04T04:30:12.345Z" }] } as never;
      expect(prepareTransportInput(formValuesFromTransport(input), "outbound", undefined, undefined, input))
        .toMatchObject({ ok: true, value: { details: input.details } });
    } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  });
  it("rejects a new local clock in a daylight-saving gap", () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = "America/New_York";
      const values = { ...formValuesFromTransport(canonical()), departureAt: "2026-03-08T01:30", arrivalAt: "2026-03-08T04:00",
        steps: [{ line: "1", fromStop: "A", toStop: "B", estimatedTime: "02:30" }] };
      expect(prepareTransportInput(values, "outbound")).toMatchObject({ ok: false,
        errors: { "details.steps[0].estimatedTime": expect.any(String) } });
    } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  });
  it("preserves the second occurrence of a repeated daylight-saving clock", () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = "America/New_York";
      const input = canonical();
      input.departureAt = "2026-11-01T04:30:00.000Z"; input.arrivalAt = "2026-11-01T08:00:00.000Z";
      input.details = { steps: [{ line: "1", fromStop: "A", toStop: "B", estimatedAt: "2026-11-01T06:30:12.345Z" }] } as never;
      expect(prepareTransportInput(formValuesFromTransport(input), "outbound", undefined, undefined, input))
        .toMatchObject({ ok: true, value: { details: input.details } });
    } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  });
  it("uses the second clock occurrence when the first would precede departure", () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = "America/New_York";
      const values = { ...formValuesFromTransport(canonical()), departureAt: "2026-11-01T01:45", arrivalAt: "2026-11-01T03:00",
        steps: [{ line: "1", fromStop: "A", toStop: "B", estimatedTime: "01:30" }] };
      expect(prepareTransportInput(values, "outbound")).toMatchObject({ ok: true,
        value: { details: { steps: [{ estimatedAt: "2026-11-01T06:30:00.000Z" }] } } });
    } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  });
});
