import { describe, expect, it } from "vitest";

import { displayName } from "./display-name.js";

describe("displayName", () => {
  it.each([null, "", "   "])("uses a neutral label for %j", (name) => {
    expect(displayName(name)).toBe("Integrante");
  });

  it("returns a real name unchanged", () => {
    expect(displayName("Ana")).toBe("Ana");
  });
});
