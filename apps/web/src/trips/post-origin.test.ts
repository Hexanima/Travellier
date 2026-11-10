import { describe, expect, it } from "vitest";
import { anchorSelector, buildOrigin, canGoBack, withNoBack, diaryOrigin, itineraryAnchor, memoryAnchor, originHref, originLabel, photoAnchor, readOrigin, readPhoto, readRestore } from "./post-origin.js";

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
    expect(readRestore({ restore: { anchor, scrollY: 300, panel: "comentarios" } })).toEqual({ anchor, scrollY: 300 });
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

describe("post origin: photo gallery", () => {
  const photoId = "00000000000000000000000a";
  const path = `/trips/${tripId}/memories/photos`;
  it("accepts the photos label, the photo anchor and a boolean viewer", () => {
    const origin = { path, label: "fotos", anchor: photoAnchor(photoId), scrollY: 80, viewer: true };
    expect(photoAnchor(photoId)).toBe(`data-photo=${photoId}`);
    expect(readOrigin({ origin }, tripId)).toEqual(origin);
    expect(readOrigin({ origin: { ...origin, viewer: false } }, tripId)).toEqual({ ...origin, viewer: false });
    expect(originLabel("fotos")).toBe("Volver a las fotos");
    expect(buildOrigin({ pathname: path, search: "" }, "fotos", photoAnchor(photoId), 80, true)).toEqual(origin);
  });
  it("ignores a viewer that is not a boolean without invalidating the origin", () => {
    for (const viewer of ["yes", 1, null, {}]) {
      expect(readOrigin({ origin: { path, label: "fotos", anchor: photoAnchor(photoId), scrollY: 80, viewer } }, tripId))
        .toEqual({ path, label: "fotos", anchor: photoAnchor(photoId), scrollY: 80 });
    }
  });
  it("still rejects a foreign or malformed anchor", () => {
    for (const anchor of ["data-photo=xyz", `data-photo=${photoId}0`, `data-photos=${photoId}`, `data-photo="${photoId}"`, `DATA-PHOTO=${photoId}`])
      expect(readOrigin({ origin: { path, label: "fotos", anchor } }, tripId), anchor).toEqual(diary);
    expect(anchorSelector(photoAnchor(photoId))).toBe(`[data-photo="${photoId}"]`);
    expect(anchorSelector("data-photo=] body")).toBeUndefined();
  });
  it("keeps the restore panel only when it is photos", () => {
    const anchor = photoAnchor(photoId);
    expect(readRestore({ restore: { anchor, scrollY: 4, panel: "photos" } })).toEqual({ anchor, scrollY: 4, panel: "photos" });
    for (const panel of ["posts", 3, null, {}]) expect(readRestore({ restore: { anchor, scrollY: 4, panel } })).toEqual({ anchor, scrollY: 4 });
  });
  it("reads the open photo only when it is a valid id", () => {
    expect(readPhoto({ photo: photoId })).toBe(photoId);
    for (const state of [null, undefined, {}, { photo: "x" }, { photo: 5 }, { photo: `${photoId}0` }, { photo: photoId.toUpperCase() }]) expect(readPhoto(state)).toBeUndefined();
  });
});
