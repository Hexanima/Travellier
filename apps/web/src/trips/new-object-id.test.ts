import { afterEach, describe, expect, it, vi } from "vitest";
import { newObjectId } from "./new-object-id.js";

describe("newObjectId", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("returns 24 lowercase hex characters", () => {
    for (let index = 0; index < 50; index += 1) expect(newObjectId()).toMatch(/^[0-9a-f]{24}$/);
  });
  it("returns a different id each time", () => {
    expect(new Set(Array.from({ length: 200 }, () => newObjectId())).size).toBe(200);
  });
  it("starts with the time in seconds like an ObjectId", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-10T12:00:00.000Z"));
    expect(newObjectId().slice(0, 8)).toBe(Math.floor(Date.parse("2026-11-10T12:00:00.000Z") / 1000).toString(16).padStart(8, "0"));
  });
  it("still works without crypto", () => {
    vi.stubGlobal("crypto", undefined);
    expect(newObjectId()).toMatch(/^[0-9a-f]{24}$/);
  });
});
