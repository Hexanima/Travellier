import { describe, expect, it } from "vitest";
import { itineraryId } from "./itinerary-test-fixture.js";
import { appendPage, currentCursor, flatten, isStale, makePage, mergeFirstPage, replacePage, staleIndexes } from "./gallery-pages.js";
import type { GalleryPhoto } from "./trip-gallery-api.js";

const photo = (n: number, url = `https://s3.test/${n}`, expiresAtMs = 1_000_000): GalleryPhoto => ({
  id: itineraryId(n), postId: itineraryId(500 + n), order: 0, uploadedAt: "2026-11-10T10:00:00.000Z", uploaderId: itineraryId(600), url, expiresAtMs,
  post: { createdAt: "2026-11-10T09:00:00.000Z", authorId: itineraryId(600), rootActivityId: null, rootTransportId: null },
});
const ids = (pages: Parameters<typeof flatten>[0]) => flatten(pages).map((item) => item.id);

describe("gallery pages model", () => {
  it("makes a page with the earliest expiry of its photos", () => {
    expect(makePage(null, { photos: [photo(1, "u", 900), photo(2, "u", 700)], nextCursor: "c1" })).toEqual({ cursor: null, photos: [photo(1, "u", 900), photo(2, "u", 700)], nextCursor: "c1", expiresAtMs: 700 });
    expect(makePage(null, { photos: [], nextCursor: null }).expiresAtMs).toBe(Number.POSITIVE_INFINITY);
  });
  it("appends pages keeping the order and the first appearance of a repeated id", () => {
    const first = appendPage([], makePage(null, { photos: [photo(1, "first"), photo(2)], nextCursor: "c1" }));
    const both = appendPage(first, makePage("c1", { photos: [photo(2, "second"), photo(3), photo(1, "second")], nextCursor: null }));
    expect(ids(both)).toEqual([itineraryId(1), itineraryId(2), itineraryId(3)]);
    expect(flatten(both).map((item) => item.url)).toEqual(["first", "https://s3.test/2", "https://s3.test/3"]);
    expect(both[1]!.photos.map((item) => item.id)).toEqual([itineraryId(3)]);
    expect(first).toHaveLength(1);
  });
  it("replaces one page refreshing urls and expiry but keeping cursors, order and the other pages", () => {
    let pages = appendPage([], makePage(null, { photos: [photo(1, "old1", 500), photo(2, "old2", 500)], nextCursor: "c1" }));
    pages = appendPage(pages, makePage("c1", { photos: [photo(3, "old3", 800)], nextCursor: "c2" }));
    const next = replacePage(pages, 0, makePage(null, { photos: [photo(2, "new2", 5000), photo(1, "new1", 5000)], nextCursor: "other" }));
    expect(ids(next)).toEqual([itineraryId(1), itineraryId(2), itineraryId(3)]);
    expect(flatten(next).map((item) => item.url)).toEqual(["new1", "new2", "old3"]);
    expect(next[0]).toMatchObject({ cursor: null, nextCursor: "c1", expiresAtMs: 5000 });
    expect(next[1]).toBe(pages[1]);
    expect(replacePage(pages, 7, makePage(null, { photos: [], nextCursor: null }))).toBe(pages);
  });
  it("drops the photos the fresh answer no longer has, so no old url keeps a new expiry, and keeps the cursors", () => {
    let pages = appendPage([], makePage(null, { photos: [photo(1, "old1", 500), photo(2, "old2", 500), photo(3, "old3", 400)], nextCursor: "c1" }));
    pages = appendPage(pages, makePage("c1", { photos: [photo(4, "old4", 800)], nextCursor: null }));
    const next = replacePage(pages, 0, makePage(null, { photos: [photo(1, "new1", 5000), photo(2, "new2", 6000)], nextCursor: "other" }));
    expect(ids(next)).toEqual([itineraryId(1), itineraryId(2), itineraryId(4)]);
    expect(next[0]).toMatchObject({ cursor: null, nextCursor: "c1", expiresAtMs: 5000 });
    expect(isStale(next[0]!, 4000, 500)).toBe(false);
    expect(next[1]).toBe(pages[1]);
  });
  it("can leave a page without photos, never stale, keeping its next cursor", () => {
    const pages = appendPage([], makePage(null, { photos: [photo(1, "old1", 500)], nextCursor: "c1" }));
    const next = replacePage(pages, 0, makePage(null, { photos: [photo(9, "x", 5000)], nextCursor: "other" }));
    expect(next[0]).toMatchObject({ photos: [], nextCursor: "c1", expiresAtMs: Number.POSITIVE_INFINITY });
    expect(currentCursor(next)).toBe("c1");
  });
  it("is stale from the margin before the expiry, inclusive", () => {
    const page = makePage(null, { photos: [photo(1, "u", 100_000)], nextCursor: null });
    expect(isStale(page, 69_999, 30_000)).toBe(false);
    expect(isStale(page, 70_000, 30_000)).toBe(true);
    expect(isStale(page, 100_000)).toBe(true);
    expect(isStale(page, 69_999)).toBe(false);
    expect(isStale(page, 70_000)).toBe(true);
    expect(staleIndexes([page, makePage("c", { photos: [photo(2, "u", 900_000)], nextCursor: null })], 80_000)).toEqual([0]);
  });
  it("takes the current cursor from the last page", () => {
    expect(currentCursor([])).toBeNull();
    const pages = appendPage(appendPage([], makePage(null, { photos: [photo(1)], nextCursor: "c1" })), makePage("c1", { photos: [photo(2)], nextCursor: "c2" }));
    expect(currentCursor(pages)).toBe("c2");
    expect(currentCursor(appendPage(pages, makePage("c2", { photos: [], nextCursor: null })))).toBeNull();
  });
});

describe("mergeFirstPage (silent refresh of the first page)", () => {
  const start = () => appendPage(appendPage([], makePage(null, { photos: [photo(3, "old3"), photo(2, "old2")], nextCursor: "c1" })), makePage("c1", { photos: [photo(1, "old1")], nextCursor: null }));
  it("returns the same pages when no photo appeared or left (the signed urls are not swapped: no image reload)", () => {
    const pages = start();
    expect(mergeFirstPage(pages, makePage(null, { photos: [photo(3, "new3"), photo(2, "new2")], nextCursor: "other" }))).toBe(pages);
  });
  it("puts new photos first, keeps the known ones with their urls, the next pages and the cursor", () => {
    const pages = start();
    const next = mergeFirstPage(pages, makePage(null, { photos: [photo(5, "new5"), photo(4, "new4"), photo(3, "new3")], nextCursor: "other" }));
    expect(ids(next)).toEqual([itineraryId(5), itineraryId(4), itineraryId(3), itineraryId(2), itineraryId(1)]);
    expect(flatten(next).map((item) => item.url)).toEqual(["new5", "new4", "old3", "old2", "old1"]);
    expect(next[0]).toMatchObject({ cursor: null, nextCursor: "c1" });
    expect(next[1]).toBe(pages[1]);
  });
  it("does not repeat a photo that already sits in a later page", () => {
    const next = mergeFirstPage(start(), makePage(null, { photos: [photo(1, "new1"), photo(3, "new3")], nextCursor: "x" }));
    expect(ids(next)).toEqual([itineraryId(3), itineraryId(2), itineraryId(1)]);
  });
  it("with a single page and a complete answer, the answer is the truth (a removed photo leaves)", () => {
    const pages = appendPage([], makePage(null, { photos: [photo(3, "old3"), photo(2, "old2")], nextCursor: null }));
    const next = mergeFirstPage(pages, makePage(null, { photos: [photo(3, "new3")], nextCursor: null }));
    expect(ids(next)).toEqual([itineraryId(3)]);
    expect(flatten(next).map((item) => item.url)).toEqual(["old3"]);
  });
  it("with more new photos than a page (no overlap with the old first page), it restarts from the fresh page and its cursor, keeping known urls, with no gap", () => {
    const pages = start();
    const next = mergeFirstPage(pages, makePage(null, { photos: [photo(8, "new8"), photo(7, "new7")], nextCursor: "fresh" }));
    expect(ids(next)).toEqual([itineraryId(8), itineraryId(7)]);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ cursor: null, nextCursor: "fresh" });
    expect(currentCursor(next)).toBe("fresh");
  });
  it("with no overlap, a photo the fresh page has that was already loaded keeps its loaded snapshot and url", () => {
    const pages = start();
    // 1 sits in a later page, not in the old first page: the fresh page has no id of the old first one.
    const next = mergeFirstPage(pages, makePage(null, { photos: [photo(8, "new8"), photo(1, "new1")], nextCursor: "fresh" }));
    expect(ids(next)).toEqual([itineraryId(8), itineraryId(1)]);
    expect(flatten(next).map((item) => item.url)).toEqual(["new8", "old1"]);
  });
  it("with a normal overlap it does not discard the following pages", () => {
    const pages = start();
    const next = mergeFirstPage(pages, makePage(null, { photos: [photo(9, "new9"), photo(2, "new2")], nextCursor: "fresh" }));
    expect(next).toHaveLength(2);
    expect(next[1]).toBe(pages[1]);
    expect(next[0]).toMatchObject({ nextCursor: "c1" });
  });
  it("ignores pages that do not start at the first cursor", () => {
    const pages = [makePage("c1", { photos: [photo(1)], nextCursor: null })];
    expect(mergeFirstPage(pages, makePage(null, { photos: [photo(9)], nextCursor: null }))).toBe(pages);
  });
});
