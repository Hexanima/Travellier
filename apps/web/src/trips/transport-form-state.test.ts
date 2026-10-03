import { describe, expect, it } from "vitest";

import { formValuesFromTransport, prepareTransportInput, type TransportFormValues } from "./transport-form-state.js";
import type { JourneyTransport } from "./trip-journey-api.js";

const values: TransportFormValues = {
  type: "flight", departurePlace: " AEP ", departureAt: "2026-10-01T09:00",
  arrivalPlace: " BRC ", arrivalAt: "2026-10-01T11:00",
  costPerPerson: "150", flightNumber: " AR123 ", company: "Ignorar",
  steps: [{ line: "21", fromStop: "A", toStop: "B", estimatedTime: "09:00" }],
};

const precise: JourneyTransport = {
  id: "507f1f77bcf86cd799439014", tripId: "507f191e810c19729de860ea", destinationId: "507f1f77bcf86cd799439013",
  type: "flight", direction: "return", departurePlace: "A", arrivalPlace: "B", costPerPerson: null, details: {},
  departureAt: "2026-10-10T10:00:30.125-03:00", arrivalAt: "2026-10-10T12:00:45.678-03:00",
};

describe("prepareTransportInput", () => {
  it("preserves the original timestamps when editing another field", () => {
    const loaded = formValuesFromTransport(precise);
    expect(prepareTransportInput({ ...loaded, departurePlace: "C" }, precise.direction, undefined, undefined, precise))
      .toMatchObject({ ok: true, value: { departurePlace: "C", departureAt: precise.departureAt, arrivalAt: precise.arrivalAt } });
  });

  it.each(["departureAt", "arrivalAt"] as const)("updates only the edited %s timestamp", (field) => {
    const loaded = formValuesFromTransport(precise);
    const untouched = field === "departureAt" ? "arrivalAt" : "departureAt";
    const changedInstant = new Date(Date.parse(precise[field]) + (field === "departureAt" ? -1 : 1) * 3_600_000).toISOString();
    const changed = formValuesFromTransport({ ...precise, [field]: changedInstant })[field];
    expect(prepareTransportInput({ ...loaded, [field]: changed }, precise.direction, undefined, undefined, precise))
      .toMatchObject({ ok: true, value: { [field]: new Date(changed).toISOString(), [untouched]: precise[untouched] } });
  });

  it("validates an unchanged departure against the exact complementary arrival", () => {
    const loaded = formValuesFromTransport(precise);
    expect(prepareTransportInput(loaded, "return", {
      direction: "outbound", departureAt: "2026-10-10T08:00:00.000-03:00", arrivalAt: precise.departureAt,
    }, undefined, precise)).toMatchObject({ ok: true, value: { departureAt: precise.departureAt } });
  });

  it("does not hide an actual second-level conflict by truncating an unchanged arrival", () => {
    const current = { ...precise, direction: "outbound" as const,
      departureAt: "2026-10-10T08:00:00.000-03:00", arrivalAt: precise.departureAt };
    expect(prepareTransportInput(formValuesFromTransport(current), "outbound", {
      direction: "return", departureAt: "2026-10-10T10:00:15.000-03:00", arrivalAt: precise.arrivalAt,
    }, undefined, current)).toMatchObject({ ok: false, errors: { arrivalAt: expect.any(String) } });
  });

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

  it("rejects an arrival after the destination's saved departure", () => {
    expect(prepareTransportInput(values, "outbound", { direction: "return",
      departureAt: new Date("2026-10-01T10:00").toISOString(), arrivalAt: new Date("2026-10-01T12:00").toISOString() }))
      .toMatchObject({ ok: false, errors: { arrivalAt: expect.any(String) } });
  });

  it("rejects a departure before the destination's saved arrival", () => {
    expect(prepareTransportInput(values, "return", { direction: "outbound",
      departureAt: new Date("2026-10-01T08:00").toISOString(), arrivalAt: new Date("2026-10-01T10:00").toISOString() }))
      .toMatchObject({ ok: false, errors: { departureAt: expect.any(String) } });
  });

  it("allows a destination window whose arrival and departure coincide", () => {
    expect(prepareTransportInput(values, "outbound", { direction: "return",
      departureAt: new Date(values.arrivalAt).toISOString(), arrivalAt: new Date("2026-10-01T12:00").toISOString() }).ok).toBe(true);
    expect(prepareTransportInput(values, "return", { direction: "outbound",
      departureAt: new Date("2026-10-01T08:00").toISOString(), arrivalAt: new Date(values.departureAt).toISOString() }).ok).toBe(true);
  });

  it("rejects an arrival before the previous destination's departure", () => {
    expect(prepareTransportInput(values, "outbound", undefined, {
      previousDepartureAt: new Date("2026-10-02T12:00").toISOString(),
    })).toMatchObject({ ok: false, errors: { arrivalAt: expect.any(String) } });
  });

  it("rejects a departure after the next destination's arrival", () => {
    expect(prepareTransportInput(values, "return", undefined, {
      nextArrivalAt: new Date("2026-09-30T18:00").toISOString(),
    })).toMatchObject({ ok: false, errors: { departureAt: expect.any(String) } });
  });

  it.each([0, 60_000])("allows neighboring destination boundaries separated by %s milliseconds", (gap) => {
    expect(prepareTransportInput(values, "outbound", undefined, {
      previousDepartureAt: new Date(new Date(values.arrivalAt).getTime() - gap).toISOString(),
    }).ok).toBe(true);
    expect(prepareTransportInput(values, "return", undefined, {
      nextArrivalAt: new Date(new Date(values.departureAt).getTime() + gap).toISOString(),
    }).ok).toBe(true);
  });

  it("bounds both destination timestamps even when their complementary transport is missing", () => {
    expect(prepareTransportInput(values, "outbound", undefined, {
      nextArrivalAt: new Date("2026-09-30T18:00").toISOString(),
    })).toMatchObject({ ok: false, errors: { arrivalAt: expect.any(String) } });
    expect(prepareTransportInput(values, "return", undefined, {
      previousDepartureAt: new Date("2026-10-02T12:00").toISOString(),
    })).toMatchObject({ ok: false, errors: { departureAt: expect.any(String) } });
  });

  it.each(["outbound", "return"] as const)("uses the known arrival of a previous destination for %s", (direction) => {
    expect(prepareTransportInput(values, direction, undefined, {
      previousArrivalAt: new Date("2026-10-02T12:00").toISOString(),
    })).toMatchObject({ ok: false, errors: { [direction === "outbound" ? "arrivalAt" : "departureAt"]: expect.any(String) } });
  });

  it.each(["outbound", "return"] as const)("uses the known departure of a next destination for %s", (direction) => {
    expect(prepareTransportInput(values, direction, undefined, {
      nextDepartureAt: new Date("2026-09-30T18:00").toISOString(),
    })).toMatchObject({ ok: false, errors: { [direction === "outbound" ? "arrivalAt" : "departureAt"]: expect.any(String) } });
  });

  it.each(["outbound", "return"] as const)("allows equal known partial boundaries for %s", (direction) => {
    const boundary = new Date(direction === "outbound" ? values.arrivalAt : values.departureAt).toISOString();
    expect(prepareTransportInput(values, direction, undefined, {
      previousArrivalAt: boundary, nextDepartureAt: boundary,
    }).ok).toBe(true);
  });

  it.each([
    { times: ["09:30", "08:30"], invalidIndex: 1 },
    { times: ["07:59"], invalidIndex: 0 },
    { times: ["10:01"], invalidIndex: 0 },
  ])("rejects urban step times $times outside their interval or sequence", ({ times, invalidIndex }) => {
    expect(prepareTransportInput({ ...values, type: "bus_local", departureAt: "2026-10-01T08:00", arrivalAt: "2026-10-01T10:00",
      steps: times.map((estimatedTime) => ({ line: "21", fromStop: "A", toStop: "B", estimatedTime })) }, "outbound"))
      .toMatchObject({ ok: false, errors: { [`details.steps[${invalidIndex}].estimatedTime`]: expect.any(String) } });
  });

  it.each([
    { departureAt: "2026-10-01T08:00", arrivalAt: "2026-10-01T10:00", times: ["08:00", "08:00", "10:00"] },
    { departureAt: "2026-10-01T23:30", arrivalAt: "2026-10-02T01:00", times: ["23:45", "00:30"] },
  ])("allows ordered urban steps within $departureAt to $arrivalAt", ({ departureAt, arrivalAt, times }) => {
    expect(prepareTransportInput({ ...values, type: "bus_local", departureAt, arrivalAt,
      steps: times.map((estimatedTime) => ({ line: "21", fromStop: "A", toStop: "B", estimatedTime })) }, "outbound").ok).toBe(true);
  });

  it.each(["flight", "bus_long"] as const)("sends null to clear the optional detail of %s", (type) => {
    expect(prepareTransportInput({ ...values, type, flightNumber: " ", company: " " }, "outbound"))
      .toMatchObject({ ok: true, value: { details: type === "flight" ? { flightNumber: null } : { company: null } } });
  });
});
