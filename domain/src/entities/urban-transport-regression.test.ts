import { describe, expect, it } from "vitest";
import { createTransport, readTransport, type Transport } from "./transport.js";

const transport = (times: string[]) => ({
  id: "507f1f77bcf86cd799439014", tripId: "507f191e810c19729de860ea", destinationId: "507f1f77bcf86cd799439013",
  direction: "outbound", type: "bus_local", departurePlace: "A", arrivalPlace: "B", costPerPerson: null,
  departureAt: new Date("2026-10-03T23:30:00.123Z"), arrivalAt: new Date("2026-10-04T01:00:00.456Z"),
  details: { steps: times.map((time) => ({ line: "1", fromStop: "A", toStop: "B", estimatedAt: new Date(time) })) },
} as unknown as Transport);

describe("urban transport instants", () => {
  it("accepts ordered UTC steps across midnight, including exact boundaries", () => {
    const input = transport(["2026-10-03T23:30:00.123Z", "2026-10-03T23:30:00.123Z", "2026-10-04T00:30:00Z", "2026-10-04T01:00:00.456Z"]);
    expect(createTransport(input)).toEqual({ ok: true, value: input });
  });
  it.each([
    ["2026-10-03T23:30:00.122Z", "outside_transport"],
    ["2026-10-04T01:00:00.457Z", "outside_transport"],
    ["invalid", "invalid"],
  ])("rejects the step instant %s", (time, code) => {
    expect(createTransport(transport([time]))).toMatchObject({ ok: false,
      error: { issues: [{ field: "details.steps[0].estimatedAt", code }] } });
  });
  it("rejects a descending sequence even when each instant fits the interval", () => {
    expect(createTransport(transport(["2026-10-04T00:30:00Z", "2026-10-04T00:00:00Z"]))).toMatchObject({ ok: false,
      error: { issues: [{ field: "details.steps[1].estimatedAt", code: "before_previous_step" }] } });
  });
  it("requires reconfirmation of legacy clock-only steps on writes", () => {
    const input = { ...transport([]), details: { steps: [{ line: "1", fromStop: "A", toStop: "B", estimatedTime: "19:00" }] } };
    expect(createTransport(input as Transport)).toMatchObject({ ok: false,
      error: { issues: [{ field: "details.steps[0].estimatedAt", code: "required" }] } });
    expect(readTransport(input as Transport)).toEqual({ ok: true, value: input });
  });
});
