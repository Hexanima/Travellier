// Contract test: the client consumes the REAL output of the domain read model, serialized as JSON.
import * as domain from "app-domain";
import { describe, expect, it, vi } from "vitest";
import { createTripItineraryApi, type TripItineraryResponse } from "./trip-itinerary-api.js";
import { projectItineraryView } from "./trip-itinerary-view.js";

const id = (n: number) => {
  const result = domain.createObjectId(n.toString(16).padStart(24, "0"));
  if (!result.ok) throw result.error;
  return result.value;
};
const tripId = id(1), actor = id(2), destinationId = id(3);
const at = (hour: number, minute = 0, day = "2026-09-25") =>
  new Date(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.123Z`);
const ids = { outDay: id(4), activityDay: id(5), returnDay: id(6), outbound: id(7), inbound: id(8), activity: id(9), removed: id(99) };

function snapshot(): domain.TripItinerarySnapshot {
  const base = { tripId, destinationId, date: at(0) };
  const transport = { tripId, destinationId, type: "car" as const, departurePlace: "Origen", arrivalPlace: "Córdoba", costPerPerson: 10, details: {} };
  const post = (n: number, createdAt: Date, links: Partial<{ activityId: domain.ObjectId; transportId: domain.ObjectId; parentPostId: domain.ObjectId }> = {}) => ({
    id: id(n), tripId, dayId: ids.activityDay, authorId: actor, description: `post ${n}`, mapsUrl: null,
    activityId: links.activityId ?? null, transportId: links.transportId ?? null, parentPostId: links.parentPostId ?? null, createdAt,
  });
  const expense = (n: number, postId: number, totalAmount: number) => ({ id: id(n), tripId, postId: id(postId), totalAmount, breakdown: null, paidBy: null, createdAt: at(12) });
  return {
    trip: { id: tripId, expenseMode: "register" },
    destinations: [{ id: destinationId, tripId, name: "Córdoba", order: 1, createdAt: at(0) }],
    days: [
      { ...base, id: ids.outDay, type: "transit_out", startsAt: at(8), endsAt: at(10), order: 1 },
      { ...base, id: ids.activityDay, type: "activity", startsAt: at(10), endsAt: at(18), order: 2 },
      { ...base, id: ids.returnDay, type: "transit_return", startsAt: at(18), endsAt: at(20), order: 3 },
    ],
    transports: [
      { ...transport, id: ids.outbound, direction: "outbound", departureAt: at(8), arrivalAt: at(10) },
      { ...transport, id: ids.inbound, direction: "return", departureAt: at(18), arrivalAt: at(20) },
    ],
    activities: [{ id: ids.activity, tripId, dayId: ids.activityDay, title: "Paseo", description: null, scheduledAt: at(12), durationMinutes: 90,
      mapsUrl: null, createdBy: actor, createdAt: at(11) }],
    posts: [
      // Chain root -> child -> grandchild under the activity; only the root carries the link.
      post(30, at(13), { activityId: ids.activity }), post(31, at(14), { parentPostId: id(30) }), post(32, at(15), { parentPostId: id(31) }),
      // Transport post with a child.
      post(33, at(9), { transportId: ids.outbound }), post(34, at(9, 30), { parentPostId: id(33) }),
      // Independent inside a band, outside every band but on an existing UTC date, and on a date without days.
      post(35, at(11)), post(36, at(22)), post(37, at(10, 0, "2026-12-01")),
      // Removed activity: the stored link is dangling, so the chain is projected as independent.
      post(38, at(16), { activityId: ids.removed }), post(39, at(16, 30), { parentPostId: id(38) }),
    ],
    expenses: [expense(50, 32, 12), expense(51, 35, 8), expense(52, 36, 4), expense(53, 37, 100), expense(54, 33, 3)],
  };
}

const respond = async (f: domain.TripItinerarySnapshot = snapshot()) => {
  const result = await domain.getTripItinerary.execute({
    members: { findByTripAndUser: async () => domain.ok({ id: id(70), tripId, userId: actor, role: "participant" as const, joinedAt: at(0) }) },
    itinerary: { read: async () => domain.ok(f) },
  }, { tripId, authenticatedUserId: actor });
  if (!result.ok) throw result.error;
  // What the client really receives: JSON over HTTP.
  return JSON.parse(JSON.stringify(result.value)) as TripItineraryResponse & { unplacedPosts: unknown[] };
};
const read = async (f?: domain.TripItinerarySnapshot) => {
  const itinerary = await respond(f);
  const get = vi.fn().mockResolvedValue({ ok: true, value: { itinerary } });
  return { itinerary, result: await createTripItineraryApi({ get }).get(itinerary.tripId) };
};

describe("itinerary contract with the real read model", () => {
  it("includes context and unplacedPosts and drops legacy voting and arrival fields", async () => {
    const itinerary = await respond();
    expect(itinerary).not.toHaveProperty("votingEnabled");
    expect(itinerary.days.map((day) => day.type)).not.toContain("arrival");
    expect(itinerary.unplacedPosts).toHaveLength(1);
    expect(itinerary.posts.every((post) => typeof post.context === "object" && post.context !== null)).toBe(true);
    // Descendants of the activity carry no own link: only their context points to the root activity.
    const grandchild = itinerary.posts.find((post) => post.id === id(32))!;
    expect(grandchild.activityId).toBeNull();
    expect(grandchild.context).toMatchObject({ rootActivityId: ids.activity, rootPostId: id(30), placement: "activity" });
    expect(itinerary.posts.find((post) => post.id === id(38))?.context.placement).toBe("independent");
    expect(itinerary.activities[0]).not.toHaveProperty("status");
  });
  it("is accepted by the client validator, so no valid response is rejected", async () => {
    const { itinerary, result } = await read();
    expect(result).toEqual({ ok: true, value: itinerary });
  });
  it.each(["UTC", "America/Argentina/Buenos_Aires"])("projects every post exactly once in %s", async (timeZone) => {
    const { result } = await read();
    if (!result.ok) throw new Error("rejected");
    const itinerary = result.value, view = projectItineraryView(itinerary, timeZone);
    const items = view.days.flatMap((day) => day.segments.flatMap((segment) => segment.items));
    const placed = [
      ...items.flatMap((item) => item.kind === "activity" || item.kind === "transport" ? item.posts.map((p) => p.id) : [item.id]),
      ...view.outsidePosts.map((post) => post.id),
    ].sort();
    expect(placed).toEqual([...itinerary.posts, ...itinerary.unplacedPosts].map((post) => post.id).sort());
    const activity = items.find((item) => item.kind === "activity");
    expect(activity?.kind === "activity" ? activity.posts.map((p) => p.id) : []).toEqual([id(30), id(31), id(32)]);
    const outbound = items.find((item) => item.kind === "transport" && item.id === ids.outbound);
    expect(outbound?.kind === "transport" ? outbound.posts.map((p) => p.id) : []).toEqual([id(33), id(34)]);
    expect(view.outsidePosts.map((post) => post.id)).toEqual([id(37)]);
    // The removed activity's chain is now projected by publication.
    expect(items.filter((item) => item.kind === "post").map((item) => item.id)).toEqual(expect.arrayContaining([id(38), id(39), id(35), id(36)]));
  });
  it("adds up the same expenses as the server, except those without a day", async () => {
    const { itinerary, result } = await read();
    if (!result.ok) throw new Error("rejected");
    const view = projectItineraryView(result.value, "UTC");
    const sum = (summaries: { totalAmount: number; expenseCount: number }[]) =>
      ({ totalAmount: summaries.reduce((total, s) => total + s.totalAmount, 0), expenseCount: summaries.reduce((count, s) => count + s.expenseCount, 0) });
    const unplaced = (itinerary.unplacedPosts as TripItineraryResponse["posts"]).filter((post) => post.expense !== null);
    const server = sum(itinerary.days.map((day) => day.expenseSummary));
    expect(sum(view.days.map((day) => day.expenseSummary))).toEqual(server);
    expect(sum(view.days.map((day) => day.expenseSummary))).toEqual({ totalAmount: 27, expenseCount: 4 });
    expect(unplaced.map((post) => post.expense!.totalAmount)).toEqual([100]);
  });
});

describe("itinerary contract after removing an activity (T55 persistence contract)", () => {
  // The read model has no participations: only the activities and posts the server keeps after the DELETE are modelled here.
  const second = (): domain.TripItinerarySnapshot["activities"][number] => ({ id: id(61), tripId, dayId: ids.activityDay, title: "Museo", description: null,
    scheduledAt: at(15, 30), durationMinutes: null, mapsUrl: null, createdBy: actor, createdAt: at(11) });
  const before = (): domain.TripItinerarySnapshot => { const f = snapshot(); return { ...f, activities: [...f.activities, second()] }; };
  /** What the backend leaves after `deleteTripActivity`: the activity is gone, its posts keep their chain but lose the direct link. */
  // The read model also normalises a dangling link to null by itself (getTripItinerary), so the stored state and the response agree either way.
  const after = (): domain.TripItinerarySnapshot => { const f = before();
    return { ...f, activities: f.activities.filter((activity) => activity.id !== ids.activity),
      posts: f.posts.map((post) => post.activityId === ids.activity ? { ...post, activityId: null } : post) }; };
  const view = (value: TripItineraryResponse) => projectItineraryView(value, "UTC");
  const items = (value: TripItineraryResponse) => view(value).days.flatMap((day) => day.segments.flatMap((segment) => segment.items));

  it("keeps the whole chain in posts[] as independent posts with their parent links, and no direct activity link", async () => {
    const [kept, removed] = [await respond(before()), await respond(after())];
    for (const n of [30, 31, 32]) expect(kept.posts.find((post) => post.id === id(n))?.context.placement).toBe("activity");
    for (const n of [30, 31, 32]) {
      const post = removed.posts.find((candidate) => candidate.id === id(n))!;
      expect(post, `post ${n} kept`).toBeDefined();
      expect(post.activityId).toBeNull();
      expect(post.context).toMatchObject({ placement: "independent", rootActivityId: null, rootPostId: id(30) });
    }
    expect(removed.posts.find((post) => post.id === id(31))!.parentPostId).toBe(id(30));
    expect(removed.posts.find((post) => post.id === id(32))!.parentPostId).toBe(id(31));
    expect(removed.posts.map((post) => post.id).sort()).toEqual(kept.posts.map((post) => post.id).sort());
  });
  it("is accepted by the client validator and drops only the removed activity, leaving the other one identical", async () => {
    const [kept, removed] = [await read(before()), await read(after())];
    if (!kept.result.ok || !removed.result.ok) throw new Error("rejected");
    expect(removed.result.value).toEqual(removed.itinerary);
    expect(kept.result.value.activities.map((activity) => activity.id)).toEqual([ids.activity, id(61)]);
    expect(removed.result.value.activities.map((activity) => activity.id)).toEqual([id(61)]);
    expect(removed.result.value.activities[0]).toEqual(kept.result.value.activities[1]);
  });
  it("projects every post once: the chain moves from under the activity to the band, nothing is lost", async () => {
    const [kept, removed] = [await read(before()), await read(after())];
    if (!kept.result.ok || !removed.result.ok) throw new Error("rejected");
    const nested = (value: TripItineraryResponse) => items(value).flatMap((item) => item.kind === "activity" || item.kind === "transport" ? item.posts.map((p) => p.id) : [item.id]);
    const everywhere = (value: TripItineraryResponse) => [...nested(value), ...view(value).outsidePosts.map((post) => post.id)].sort();
    expect(everywhere(removed.result.value)).toEqual(everywhere(kept.result.value));
    expect(everywhere(removed.result.value)).toEqual([...removed.result.value.posts, ...removed.result.value.unplacedPosts].map((post) => post.id).sort());
    const activity = (value: TripItineraryResponse) => items(value).find((item) => item.kind === "activity" && item.id === ids.activity);
    expect(activity(kept.result.value)).toBeDefined();
    expect(activity(removed.result.value)).toBeUndefined();
    expect(items(removed.result.value).filter((item) => item.kind === "post").map((item) => item.id)).toEqual(expect.arrayContaining([id(30), id(31), id(32)]));
    const museum = items(removed.result.value).find((item) => item.kind === "activity" && item.id === id(61));
    expect(museum?.kind === "activity" ? museum.posts : null).toEqual([]);
  });
  it("keeps the expenses of the chain in the day totals", async () => {
    const [kept, removed] = [await read(before()), await read(after())];
    if (!kept.result.ok || !removed.result.ok) throw new Error("rejected");
    const totals = (value: TripItineraryResponse) => view(value).days.map((day) => day.expenseSummary);
    expect(totals(removed.result.value)).toEqual(totals(kept.result.value));
    expect(totals(removed.result.value).reduce((sum, day) => sum + day.totalAmount, 0)).toBe(27);
    expect(removed.result.value.posts.find((post) => post.id === id(32))!.expense).toMatchObject({ totalAmount: 12 });
  });
});
