import { describe, expect, it } from "vitest";

import { formValuesFromTransport, prepareTransportInput, type TransportFormValues } from "./transport-form-state.js";

const values: TransportFormValues = {
  type: "flight", departurePlace: " AEP ", departureAt: "2026-10-01T09:00",
  arrivalPlace: " BRC ", arrivalAt: "2026-10-01T11:00",
  costPerPerson: "150", flightNumber: " AR123 ", company: "Ignorar",
  steps: [{ line: "21", fromStop: "A", toStop: "B", estimatedTime: "09:00" }],
};

describe("prepareTransportInput", () => {
  it("loads saved instants into local date-time controls", () => {
    const instant = new Date("2026-10-01T12:00:00.000Z");
    const loaded = formValuesFromTransport({ ...values, departureAt: instant.toISOString(),
      arrivalAt: instant.toISOString(), costPerPerson: 150, details: { flightNumber: "AR123" } } as never);
    const pad = (part: number) => String(part).padStart(2, "0");
    expect(loaded.departureAt).toBe(`${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}T${pad(instant.getHours())}:${pad(instant.getMinutes())}`);
    expect(loaded.flightNumber).toBe("AR123");
  });

  it("sends only flight fields and converts local date-times to ISO instants", () => {
    const result = prepareTransportInput(values, "outbound");
    expect(result).toEqual({ ok: true, value: {
      direction: "outbound", type: "flight", departurePlace: "AEP",
      departureAt: new Date("2026-10-01T09:00").toISOString(), arrivalPlace: "BRC",
      arrivalAt: new Date("2026-10-01T11:00").toISOString(), costPerPerson: 150,
      details: { flightNumber: "AR123" },
    } });
  });

  it("sends company for long-distance bus and no unrelated details for car or other", () => {
    expect(prepareTransportInput({ ...values, type: "bus_long", company: " Via Bariloche " }, "return")).toMatchObject({
      ok: true, value: { direction: "return", type: "bus_long", details: { company: "Via Bariloche" } },
    });
    for (const type of ["car", "other"] as const) {
      expect(prepareTransportInput({ ...values, type }, "outbound")).toMatchObject({
        ok: true, value: { type, details: {}, costPerPerson: null },
      });
    }
  });

  it("keeps urban bus steps in their entered order", () => {
    const steps = [
      { line: "21", fromStop: " Terminal ", toStop: " Plaza ", estimatedTime: "09:00" },
      { line: "8", fromStop: " Plaza ", toStop: " Hotel ", estimatedTime: "09:25" },
    ];
    expect(prepareTransportInput({ ...values, type: "bus_local", steps }, "outbound")).toMatchObject({
      ok: true, value: { type: "bus_local", costPerPerson: null, details: { steps: [
        { line: "21", fromStop: "Terminal", toStop: "Plaza", estimatedTime: "09:00" },
        { line: "8", fromStop: "Plaza", toStop: "Hotel", estimatedTime: "09:25" },
      ] } },
    });
  });

  it("rejects invalid dates and arrival before departure before submitting", () => {
    expect(prepareTransportInput({ ...values, arrivalAt: "" }, "outbound")).toMatchObject({
      ok: false, errors: { arrivalAt: expect.any(String) },
    });
    expect(prepareTransportInput({ ...values, arrivalAt: "2026-09-30T09:00" }, "outbound")).toMatchObject({
      ok: false, errors: { arrivalAt: expect.any(String) },
    });
    expect(prepareTransportInput({ ...values, departureAt: "2026-02-31T09:00" }, "outbound")).toMatchObject({
      ok: false, errors: { departureAt: expect.any(String) },
    });
  });

  it("rejects incomplete or malformed urban steps with field-specific errors", () => {
    expect(prepareTransportInput({ ...values, type: "bus_local", steps: [] }, "outbound")).toMatchObject({
      ok: false, errors: { "details.steps": expect.any(String) },
    });
    expect(prepareTransportInput({ ...values, type: "bus_local", steps: [
      { line: "", fromStop: "A", toStop: "B", estimatedTime: "25:00" },
    ] }, "outbound")).toMatchObject({
      ok: false, errors: { "details.steps[0].line": expect.any(String), "details.steps[0].estimatedTime": expect.any(String) },
    });
  });
});
