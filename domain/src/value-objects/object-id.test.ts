import { describe, expect, it } from "vitest";

import * as domain from "../index.js";

describe("ObjectId", () => {
  it("creates a branded identifier from a canonical MongoDB ObjectId", () => {
    expect("createObjectId" in domain).toBe(true);

    if ("createObjectId" in domain) {
      const result = domain.createObjectId("507f1f77bcf86cd799439011");

      expect(result).toEqual({
        ok: true,
        value: "507f1f77bcf86cd799439011",
      });
    }
  });

  it.each([
    "",
    "507f1f77bcf86cd79943901",
    "507f1f77bcf86cd7994390110",
    "507f1f77bcf86cd79943901g",
  ])("returns a tagged validation error for an invalid value: %s", (value) => {
    expect("createObjectId" in domain).toBe(true);

    if ("createObjectId" in domain) {
      const result = domain.createObjectId(value);

      expect(result).toMatchObject({
        ok: false,
        error: {
          tag: "InvalidObjectIdError",
          value,
        },
      });
    }
  });
});
