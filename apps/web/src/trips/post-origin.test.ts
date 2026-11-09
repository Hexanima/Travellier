import { describe, expect, it } from "vitest";
import { anchorSelector, buildOrigin, canGoBack, withNoBack, diaryOrigin, itineraryAnchor, memoryAnchor, originHref, originLabel, readOrigin, readRestore } from "./post-origin.js";

const tripId = "000000000000000000000001";
const diary = { path: `/trips/${tripId}/memories`, label: "diario" };

describe("post origin", () => {
  it("falls back to the diary when there is no state", () => {
    expect(readOrigin(undefined, tripId)).toEqual(diary);
    expect(readOrigin(null, tripId)).toEqual(diary);
    expect(readOrigin({}, tripId)).toEqual(diary);
    expect(readOrigin({ origin: "x" }, tripId)).toEqual(diary);
    expect(diaryOrigin(tripId)).toEqual(diary);
  });
  it("accepts a valid origin of the same trip, keeping its search, anchor and scroll", () => {
    const origin = { path: `/trips/${tripId}/itinerary`, search: "?day=2", anchor: itineraryAnchor("000000000000000000000005"), scrollY: 240, label: "itinerario" };
    expect(readOrigin({ origin }, tripId)).toEqual(origin);
    expect(readOrigin({ origin: { path: `/trips/${tripId}/memories/000000000000000000000005`, label: "recuerdo" } }, tripId))
      .toEqual({ path: `/trips/${tripId}/memories/000000000000000000000005`, label: "recuerdo" });
  });
  it.each([
    ["another trip", `/trips/000000000000000000000002/itinerary`], ["a path outside trips", "/login"], ["an absolute http url", "https://evil.test/trips/000000000000000000000001/x"],
    ["a protocol-relative url", "//evil.test/trips/000000000000000000000001/x"], ["a javascript url", "javascript:alert(1)"],
    ["a double slash inside the path", `/trips/${tripId}//itinerary`], ["a parent traversal", `/trips/${tripId}/../000000000000000000000002/itinerary`],
    ["a backslash", `/trips/${tripId}/\\evil`], ["the trip root without a child", `/trips/${tripId}`], ["a path that only shares the prefix", `/trips/${tripId}0/x`],
    ["a non-string path", 4],
  ])("ignores an origin pointing to %s", (_name, path) => {
    expect(readOrigin({ origin: { path, label: "itinerario" } }, tripId)).toEqual(diary);
  });
  it("ignores an origin with an unknown label, a malformed search, anchor or scroll", () => {
    const path = `/trips/${tripId}/itinerary`;
    expect(readOrigin({ origin: { path, label: "otro" } }, tripId)).toEqual(diary);
    expect(readOrigin({ origin: { path, search: "//evil", label: "itinerario" } }, tripId)).toEqual(diary);
    expect(readOrigin({ origin: { path, anchor: "x", label: "itinerario" } }, tripId)).toEqual(diary);
    expect(readOrigin({ origin: { path, scrollY: -3, label: "itinerario" } }, tripId)).toEqual(diary);
  });
  it("builds an origin from a location with anchor and scroll", () => {
    expect(buildOrigin({ pathname: `/trips/${tripId}/memories`, search: "" }, "diario", memoryAnchor("000000000000000000000005"), 120))
      .toEqual({ path: `/trips/${tripId}/memories`, label: "diario", anchor: "data-memory=000000000000000000000005", scrollY: 120 });
    expect(buildOrigin({ pathname: `/trips/${tripId}/itinerary`, search: "?a=1" }, "itinerario"))
      .toEqual({ path: `/trips/${tripId}/itinerary`, search: "?a=1", label: "itinerario" });
  });
  it("builds the href and the label of an origin", () => {
    expect(originHref({ path: `/trips/${tripId}/itinerary`, search: "?a=1", label: "itinerario" })).toBe(`/trips/${tripId}/itinerary?a=1`);
    expect(originHref(diaryOrigin(tripId))).toBe(`/trips/${tripId}/memories`);
    expect(originLabel("diario")).toBe("Volver al diario");
    expect(originLabel("itinerario")).toBe("Volver al itinerario");
    expect(originLabel("recuerdo")).toBe("Volver al recuerdo");
  });
  it("reads a valid restore and ignores a malformed one", () => {
    const anchor = memoryAnchor("000000000000000000000005");
    expect(readRestore({ restore: { anchor, scrollY: 300 } })).toEqual({ anchor, scrollY: 300 });
    expect(readRestore({ restore: { anchor, scrollY: 300, panel: "comentarios" } })).toEqual({ anchor, scrollY: 300, panel: "comentarios" });
    expect(readRestore(null)).toBeUndefined();
    expect(readRestore({ restore: { anchor: "x", scrollY: 3 } })).toBeUndefined();
    expect(readRestore({ restore: { anchor, scrollY: "3" } })).toBeUndefined();
    expect(readRestore({ restore: { anchor, scrollY: -1 } })).toBeUndefined();
    expect(readRestore({ restore: { anchor, scrollY: Number.NaN } })).toBeUndefined();
  });
  it("can go back only with a non-initial entry that was not marked as first by a replace", () => {
    expect(canGoBack({ key: "abc123", state: null })).toBe(true);
    expect(canGoBack({ key: "abc123", state: { origin: {} } })).toBe(true);
    expect(canGoBack({ key: "default", state: null })).toBe(false);
    expect(canGoBack({ key: "abc123", state: { noBack: true } })).toBe(false);
    expect(canGoBack({ key: "abc123", state: { noBack: "yes" } })).toBe(true);
    expect(canGoBack({ key: "abc123", state: undefined })).toBe(true);
  });
  it("marks a replaced first entry so its state tells that nothing is behind it", () => {
    expect(withNoBack({ restore: 1 })).toEqual({ restore: 1, noBack: true });
    expect(withNoBack(undefined)).toEqual({ noBack: true });
    expect(withNoBack("x")).toEqual({ noBack: true });
  });
  it("only turns known anchors into a selector", () => {
    expect(anchorSelector(memoryAnchor("000000000000000000000005"))).toBe('[data-memory="000000000000000000000005"]');
    expect(anchorSelector(itineraryAnchor("000000000000000000000005"))).toBe('[data-itinerary-post="000000000000000000000005"]');
    expect(anchorSelector('data-memory="] , body')).toBeUndefined();
    expect(anchorSelector("data-other=000000000000000000000005")).toBeUndefined();
  });
});
