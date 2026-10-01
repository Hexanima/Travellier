import { describe, expect, it } from "vitest";

import { createObjectId, ok, UnknownError, type CreateTransportInput } from "../../index.js";
import { saveTransport } from "./save-transport.js";

const id = (value: string) => {
  const result = createObjectId(value);
  if (!result.ok) throw result.error;
  return result.value;
};

const transport: CreateTransportInput = {
  id: id("507f1f77bcf86cd799439014"),
  tripId: id("507f191e810c19729de860ea"),
  destinationId: id("507f1f77bcf86cd799439013"),
  direction: "outbound",
  type: "bus_local",
  departurePlace: "Terminal",
  departureAt: new Date("2026-09-24T08:00:00.000Z"),
  arrivalPlace: "Centro",
  arrivalAt: new Date("2026-09-24T09:00:00.000Z"),
  costPerPerson: null,
  details: { steps: [{ line: "20", fromStop: "Terminal", toStop: "Centro", estimatedTime: "08:30" }] },
};

describe("saveTransport", () => {
  it("does not call persistence for an invalid urban bus", async () => {
    const saved: unknown[] = [];
    const invalid = { ...transport, details: { steps: [] } };
    const result = await saveTransport.execute({
      transports: { save: async (value: unknown) => { saved.push(value); return ok(undefined); } },
    }, invalid);

    expect(result).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(saved).toEqual([]);
  });

  it("does not call persistence when arrival precedes departure", async () => {
    const saved: unknown[] = [];
    const result = await saveTransport.execute({
      transports: { save: async (value: unknown) => { saved.push(value); return ok(undefined); } },
    }, { ...transport, arrivalAt: new Date("2026-09-24T07:59:59.999Z") });

    expect(result).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(saved).toEqual([]);
  });

  it("saves a valid transport once and returns it", async () => {
    const saved: unknown[] = [];
    const result = await saveTransport.execute({
      transports: { save: async (value: unknown) => { saved.push(value); return ok(undefined); } },
    }, transport);

    expect(saved).toEqual([transport]);
    expect(result).toEqual(ok(transport));
  });

  it("propagates persistence errors", async () => {
    const failure = new UnknownError("Database unavailable.");
    const result = await saveTransport.execute({
      transports: { save: async () => ({ ok: false as const, error: failure }) },
    }, transport);

    expect(result).toEqual({ ok: false, error: failure });
  });
});
