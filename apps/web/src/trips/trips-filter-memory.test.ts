import { afterEach, describe, expect, it } from "vitest";

import { getRememberedFilter, rememberFilter, resetRememberedFilter } from "./trips-filter-memory.js";

afterEach(() => resetRememberedFilter());

describe("trips filter memory", () => {
  it("starts on active", () => expect(getRememberedFilter()).toBe("active"));
  it("remembers the last tab and resets to active", () => {
    rememberFilter("finished");
    expect(getRememberedFilter()).toBe("finished");
    rememberFilter("active");
    expect(getRememberedFilter()).toBe("active");
    rememberFilter("finished");
    resetRememberedFilter();
    expect(getRememberedFilter()).toBe("active");
  });
});
