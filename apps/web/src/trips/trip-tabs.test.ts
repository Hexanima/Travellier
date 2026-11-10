import { describe, expect, it } from "vitest";
import { rootTabOf, tabPath } from "./trip-tabs.js";

const id = "0123456789abcdef01234567";
describe("rootTabOf", () => {
  it("maps the root screens of each tab", () => {
    expect(rootTabOf(`/trips/${id}/itinerary`, id)).toEqual({ tab: "itinerary" });
    expect(rootTabOf(`/trips/${id}/memories`, id)).toEqual({ tab: "diary", panel: "posts" });
    expect(rootTabOf(`/trips/${id}/memories/photos`, id)).toEqual({ tab: "diary", panel: "photos" });
    expect(rootTabOf(`/trips/${id}/members`, id)).toEqual({ tab: "group" });
  });
  it("tolerates a trailing slash", () => {
    expect(rootTabOf(`/trips/${id}/itinerary/`, id)).toEqual({ tab: "itinerary" });
    expect(rootTabOf(`/trips/${id}/memories/photos/`, id)).toEqual({ tab: "diary", panel: "photos" });
  });
  it("is null for details, forms and other screens", () => {
    for (const path of ["memories/new", `memories/${id}`, `memories/${id}/edit`, "memories/new/link", "balance", "journey", "config", "members/x", "itinerary/x"])
      expect(rootTabOf(`/trips/${id}/${path}`, id), path).toBeNull();
  });
  it("is null for another trip or a missing id", () => {
    expect(rootTabOf(`/trips/${"f".repeat(24)}/itinerary`, id)).toBeNull();
    expect(rootTabOf(`/trips/${id}/itinerary`, undefined)).toBeNull();
    expect(rootTabOf("/trips", id)).toBeNull();
  });
});
describe("tabPath", () => {
  it("builds the root path of each tab and panel", () => {
    expect(tabPath(id, "itinerary")).toBe(`/trips/${id}/itinerary`);
    expect(tabPath(id, "diary")).toBe(`/trips/${id}/memories`);
    expect(tabPath(id, "diary", "photos")).toBe(`/trips/${id}/memories/photos`);
    expect(tabPath(id, "group")).toBe(`/trips/${id}/members`);
  });
});
