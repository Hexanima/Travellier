import { describe, expect, it } from "vitest";
import { activityMemories, memoryThumbnails, readActivityParams } from "./activity-memories.js";
import type { ItineraryPostResponse } from "./trip-itinerary-api.js";
import type { GalleryPhoto } from "./trip-gallery-api.js";

const id = (n: number) => n.toString(16).padStart(24, "0");
const ACTIVITY = id(100), OTHER = id(101), TRANSPORT = id(200);

type Overrides = { createdAt?: string; rootActivityId?: string | null; rootTransportId?: string | null; parentPostId?: string | null; placement?: "activity" | "transport" | "independent" };
const post = (n: number, o: Overrides = {}): ItineraryPostResponse => {
  const rootActivityId = o.rootActivityId === undefined ? ACTIVITY : o.rootActivityId;
  const rootTransportId = o.rootTransportId ?? null;
  const placement = o.placement ?? (rootActivityId ? "activity" : rootTransportId ? "transport" : "independent");
  return { id: id(n), description: `Recuerdo ${n}`, createdAt: o.createdAt ?? `2026-03-10T1${n % 10}:00:00.000Z`,
    context: { parentPostId: o.parentPostId ?? null, rootPostId: id(n), rootActivityId, rootTransportId, placement } } as unknown as ItineraryPostResponse;
};
const photo = (n: number, postId: string, order: number, createdAt = "2026-03-10T10:00:00.000Z"): GalleryPhoto => ({ id: id(900 + n), postId, order, uploadedAt: "2026-03-10T10:00:00.000Z", uploaderId: id(1), url: `https://s3.test/${n}`, expiresAtMs: 1,
  post: { createdAt, authorId: id(1), rootActivityId: ACTIVITY, rootTransportId: null } });

describe("activityMemories", () => {
  it("keeps the posts whose root activity is this one, descendants and unplaced posts included", () => {
    const direct = post(1), child = post(2, { parentPostId: id(1) }), unplaced = post(3);
    const result = activityMemories([direct, child], [unplaced], ACTIVITY);
    expect(result.map((item) => item.id).sort()).toEqual([id(1), id(2), id(3)]);
  });
  it("excludes posts of another activity, of a transport and independent ones", () => {
    const posts = [post(1), post(2, { rootActivityId: OTHER }), post(3, { rootActivityId: null, rootTransportId: TRANSPORT }), post(4, { rootActivityId: null })];
    expect(activityMemories(posts, [], ACTIVITY).map((item) => item.id)).toEqual([id(1)]);
  });
  it("orders by publication descending, breaks ties by id descending and drops duplicates", () => {
    const same = "2026-03-10T12:00:00.000Z";
    const result = activityMemories([post(1, { createdAt: "2026-03-10T09:00:00.000Z" }), post(2, { createdAt: same }), post(3, { createdAt: same })],
      [post(2, { createdAt: same }), post(4, { createdAt: "2026-03-10T15:00:00.000Z" })], ACTIVITY);
    expect(result.map((item) => item.id)).toEqual([id(4), id(3), id(2), id(1)]);
  });
  it("is empty when nothing belongs to the activity", () => {
    expect(activityMemories([], [], ACTIVITY)).toEqual([]);
  });
});

describe("memoryThumbnails", () => {
  const newer = post(1, { createdAt: "2026-03-10T15:00:00.000Z" }), middle = post(2, { createdAt: "2026-03-10T12:00:00.000Z" }), older = post(3, { createdAt: "2026-03-10T09:00:00.000Z" });
  const memories = [newer, middle, older];
  const of = (n: number, source: ItineraryPostResponse, order: number) => photo(n, source.id, order, source.createdAt);
  it("uses the first photo of each post (lowest order) as its thumbnail", () => {
    const first = of(1, newer, 0), second = of(2, newer, 1);
    const result = memoryThumbnails(memories, [first, second, of(3, middle, 0)], false);
    expect(result.thumbnails.get(newer.id)).toBe(first);
    expect(result.thumbnails.get(middle.id)?.id).toBe(id(903));
    expect(result.thumbnails.has(older.id)).toBe(false);
  });
  it("a post without photos is text only for certain when nothing more can be loaded", () => {
    const result = memoryThumbnails(memories, [of(1, newer, 0)], false);
    expect([...result.pending]).toEqual([]);
  });
  it("a post without photos is pending while more pages exist and the last loaded photo is not of an older post", () => {
    const result = memoryThumbnails(memories, [of(1, newer, 0)], true);
    expect([...result.pending].sort()).toEqual([middle.id, older.id].sort());
  });
  it("is text only for certain when the last loaded photo belongs to a strictly older post", () => {
    // Loaded up to `older`: `middle` has no photo for sure (its photos would have come first); nothing after `older` is known.
    const result = memoryThumbnails([newer, middle, older, post(4, { createdAt: "2026-03-10T07:00:00.000Z" })], [of(1, newer, 0), of(3, older, 0)], true);
    expect([...result.pending]).toEqual([id(4)]);
    expect(result.thumbnails.has(middle.id)).toBe(false);
  });
  it("breaks a tie of publication by id: the same instant with a smaller id is older", () => {
    const at = "2026-03-10T12:00:00.000Z";
    const high = post(6, { createdAt: at }), low = post(5, { createdAt: at });
    const certain = memoryThumbnails([high, low], [of(1, low, 0)], true);
    expect([...certain.pending]).toEqual([]); // loaded up to `low` (older than `high`): `high` has no photos
    const unknown = memoryThumbnails([high, low], [of(1, high, 0)], true);
    expect([...unknown.pending]).toEqual([low.id]); // loaded up to `high`: `low` may still have photos
  });
  it("without photos and with more pages every post is pending", () => {
    expect([...memoryThumbnails(memories, [], true).pending].sort()).toEqual(memories.map((item) => item.id).sort());
    expect([...memoryThumbnails(memories, [], false).pending]).toEqual([]);
  });
  it("compares against the post carried by the last photo even when that post is not among the memories", () => {
    expect([...memoryThumbnails([newer], [photo(1, id(777), 0, "2026-03-10T01:00:00.000Z")], true).pending]).toEqual([]);
    expect([...memoryThumbnails([newer], [photo(1, id(777), 0, "2026-03-10T20:00:00.000Z")], true).pending]).toEqual([newer.id]);
  });
});

describe("readActivityParams", () => {
  it("reads a valid activity and tab", () => {
    expect(readActivityParams(`?activity=${ACTIVITY}&tab=photos`)).toEqual({ activityId: ACTIVITY, tab: "photos" });
    expect(readActivityParams(`?activity=${ACTIVITY}&tab=memories`)).toEqual({ activityId: ACTIVITY, tab: "memories" });
  });
  it("falls back to memories for a missing or invalid tab", () => {
    expect(readActivityParams(`?activity=${ACTIVITY}`)).toEqual({ activityId: ACTIVITY, tab: "memories" });
    expect(readActivityParams(`?activity=${ACTIVITY}&tab=otra`)).toEqual({ activityId: ACTIVITY, tab: "memories" });
  });
  it("ignores an invalid activity id", () => {
    expect(readActivityParams("?activity=nope&tab=photos")).toEqual({ activityId: undefined, tab: "photos" });
    expect(readActivityParams(`?activity=${id(171).toUpperCase()}`)).toEqual({ activityId: undefined, tab: "memories" });
    expect(readActivityParams("")).toEqual({ activityId: undefined, tab: "memories" });
  });
});
