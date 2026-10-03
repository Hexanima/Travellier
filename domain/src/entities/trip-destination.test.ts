import { describe, expect, it } from "vitest";

import { createObjectId } from "../value-objects/object-id.js";
import { createTripDestination } from "./trip-destination.js";

const id = (value: string) => {
  const result = createObjectId(value);
  if (!result.ok) throw result.error;
  return result.value;
};

const input = {
  id: id("507f1f77bcf86cd799439013"),
  tripId: id("507f191e810c19729de860ea"),
  name: "Bariloche",
  order: 1,
  createdAt: new Date("2026-09-24T12:00:00.000Z"),
};

describe("createTripDestination", () => {
  it("creates a destination with its trip and sequence order", () => {
    expect(createTripDestination({ ...input, order: 2 })).toEqual({
      ok: true,
      value: { ...input, order: 2 },
    });
  });

  it("rejects an empty destination name", () => {
    expect(createTripDestination({ ...input, name: "  " })).toMatchObject({
      ok: false,
      error: { tag: "ValidationError", issues: [{ field: "name", code: "required" }] },
    });
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid order %s", (order) => {
    expect(createTripDestination({ ...input, order })).toMatchObject({
      ok: false,
      error: { tag: "ValidationError", issues: [{ field: "order", code: "invalid" }] },
    });
  });
});
