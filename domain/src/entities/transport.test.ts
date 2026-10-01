import { describe, expect, it } from "vitest";

import { createObjectId } from "../value-objects/object-id.js";
import { createTransport, type CreateTransportInput } from "./transport.js";

const id = (value: string) => {
  const result = createObjectId(value);
  if (!result.ok) throw result.error;
  return result.value;
};

const common = {
  id: id("507f1f77bcf86cd799439014"),
  tripId: id("507f191e810c19729de860ea"),
  destinationId: id("507f1f77bcf86cd799439013"),
  direction: "outbound" as const,
  departurePlace: "Retiro",
  departureAt: new Date("2026-09-24T20:00:00.000Z"),
  arrivalPlace: "Bariloche",
  arrivalAt: new Date("2026-09-25T08:00:00.000Z"),
  costPerPerson: null,
};

const local = {
  ...common,
  type: "bus_local" as const,
  details: {
    steps: [
      { line: "20", fromStop: "Terminal", toStop: "Centro", estimatedTime: "09:00" },
      { line: "10", fromStop: "Centro", toStop: "Playa", estimatedTime: "09:30" },
    ],
  },
};

const issue = (input: unknown, field: string, code: string) => {
  expect(createTransport(input as CreateTransportInput)).toMatchObject({
    ok: false,
    error: { tag: "ValidationError", issues: [{ field, code }] },
  });
};

describe("createTransport", () => {
  it("keeps urban bus steps in their configured order", () => {
    expect(createTransport(local)).toEqual({ ok: true, value: local });
  });

  it("keeps a long-distance bus as one trip with terminals, company and optional cost", () => {
    const input: CreateTransportInput = {
      ...common,
      type: "bus_long",
      departurePlace: "Terminal de Retiro",
      arrivalPlace: "Terminal Bariloche",
      costPerPerson: 120000,
      details: { company: "Via Bariloche" },
    };
    expect(createTransport(input)).toEqual({ ok: true, value: input });
  });

  it.each([
    { ...common, type: "flight" as const, details: { flightNumber: null, airline: null } },
    { ...common, type: "car" as const, details: {} },
    { ...common, type: "other" as const, details: {} },
  ])("accepts valid $type details", (input) => {
    expect(createTransport(input as CreateTransportInput)).toEqual({ ok: true, value: input });
  });

  it("rejects an urban bus without steps", () => {
    issue({ ...local, details: { steps: [] } }, "details.steps", "required");
  });

  it.each(["line", "fromStop", "toStop", "estimatedTime"])("rejects an urban step without %s", (field) => {
    issue({ ...local, details: { steps: [{ ...local.details.steps[0], [field]: " " }] } }, `details.steps[0].${field}`, "required");
  });

  it("rejects details from a different transport type", () => {
    issue({ ...common, type: "flight", details: local.details }, "details", "invalid");
    issue({ ...common, type: "bus_long", details: local.details }, "details", "invalid");
    issue({ ...local, details: { company: "Patagonia" } }, "details", "invalid");
    issue({ ...common, type: "car", details: { steps: local.details.steps } }, "details", "invalid");
  });

  it.each(["departurePlace", "arrivalPlace"])("rejects empty %s", (field) => {
    issue({ ...local, [field]: "  " }, field, "required");
  });

  it.each(["departureAt", "arrivalAt"])("rejects invalid %s", (field) => {
    issue({ ...local, [field]: new Date(Number.NaN) }, field, "invalid");
  });

  it("rejects arrival before departure", () => {
    issue({ ...local, arrivalAt: new Date("2026-09-24T19:59:59.999Z") }, "arrivalAt", "before_departure");
  });

  it("allows equal departure and arrival instants", () => {
    const input = { ...local, arrivalAt: local.departureAt };
    expect(createTransport(input)).toEqual({ ok: true, value: input });
  });

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, "100"])("rejects invalid cost %s", (costPerPerson) => {
    issue({ ...local, costPerPerson }, "costPerPerson", "invalid");
  });

  it.each([
    [{ ...local, type: "train" }, "type"],
    [{ ...local, direction: "transfer" }, "direction"],
  ])("rejects an unknown discriminator", (input, field) => {
    issue(input, field as string, "invalid");
  });
});
