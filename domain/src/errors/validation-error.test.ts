import { describe, expect, it } from "vitest";

import * as domain from "../index.js";

describe("ValidationError", () => {
  it("preserves structured validation issues under a tagged domain error", () => {
    expect("ValidationError" in domain).toBe(true);

    if ("ValidationError" in domain) {
      const issues = [
        {
          field: "name",
          code: "required",
          message: "Name is required.",
        },
      ];
      const error = new domain.ValidationError(issues);

      expect(error).toMatchObject({
        tag: "ValidationError",
        issues,
      });
    }
  });
});
