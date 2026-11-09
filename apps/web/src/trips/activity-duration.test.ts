import { describe, expect, it } from "vitest";
import { formatDuration, parseDurationInput, splitDuration } from "./activity-duration.js";

describe("activity duration helpers", () => {
  it("splits minutes into editable hours and minutes", () => {
    expect(splitDuration(null)).toEqual({ hours: "", minutes: "" });
    expect(splitDuration(undefined)).toEqual({ hours: "", minutes: "" });
    expect(splitDuration(90)).toEqual({ hours: "1", minutes: "30" });
    expect(splitDuration(45)).toEqual({ hours: "", minutes: "45" });
    expect(splitDuration(120)).toEqual({ hours: "2", minutes: "" });
  });
  it.each([
    [{ hours: "", minutes: "" }, null], [{ hours: " ", minutes: "" }, null],
    [{ hours: "1", minutes: "30" }, 90], [{ hours: "2", minutes: "" }, 120], [{ hours: "", minutes: "45" }, 45],
    [{ hours: "0", minutes: "15" }, 15], [{ hours: "30", minutes: "0" }, 1800],
  ])("parses %j", (input, value) => expect(parseDurationInput(input)).toEqual({ ok: true, value }));
  it.each([
    [{ hours: "1", minutes: "60" }, "durationMinutes"], [{ hours: "-1", minutes: "" }, "durationHours"],
    [{ hours: "", minutes: "-5" }, "durationMinutes"], [{ hours: "1.5", minutes: "" }, "durationHours"],
    [{ hours: "", minutes: "2.5" }, "durationMinutes"], [{ hours: "abc", minutes: "" }, "durationHours"],
    [{ hours: "", minutes: "x" }, "durationMinutes"], [{ hours: "0", minutes: "0" }, "durationMinutes"],
    [{ hours: "0", minutes: "" }, "durationMinutes"],
  ])("rejects %j", (input, field) =>
    expect(parseDurationInput(input)).toEqual({ ok: false, errors: { [field]: expect.any(String) } }));
  it("formats durations", () => {
    expect(formatDuration(90)).toBe("1 h 30 min");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(120)).toBe("2 h");
  });
});
