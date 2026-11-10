import { describe, expect, it } from "vitest";
import {
  createObjectId, getTripItinerary, MAX_POST_CHAIN_DEPTH, ok, projectPostRoots, type ObjectId, type Post, type TripItinerarySnapshot,
} from "../index.js";

const id = (n: number): ObjectId => {
  const parsed = createObjectId(n.toString(16).padStart(24, "0"));
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const tripId = id(1), actor = id(2), destinationId = id(3), activityA = id(40), activityB = id(41), transportId = id(50);
const at = (hour: number) => new Date(`2026-09-25T${String(hour).padStart(2, "0")}:00:00.000Z`);
const post = (n: number, fields: Partial<Post> = {}): Post => ({ id: id(n), tripId, authorId: actor, description: null, mapsUrl: null,
  activityId: null, parentPostId: null, transportId: null, createdAt: at(12), ...fields });
const roots = (posts: Post[]) => projectPostRoots(posts);

describe("projectPostRoots", () => {
  it("gives a post without links and without a parent itself as root with no context", () => {
    expect(roots([post(100)]).get(id(100))).toEqual({ rootPostId: id(100), activityId: null, transportId: null });
  });

  it("projects the activity of the root through a 4-level chain with branches", () => {
    const posts = [post(100, { activityId: activityA }), post(101, { parentPostId: id(100) }), post(102, { parentPostId: id(101) }),
      post(103, { parentPostId: id(102) }), post(104, { parentPostId: id(101) }), post(105, { parentPostId: id(100) })];
    const result = roots(posts);
    for (const n of [100, 101, 102, 103, 104, 105]) {
      expect(result.get(id(n)), String(n)).toEqual({ rootPostId: id(100), activityId: activityA, transportId: null });
    }
  });

  it("projects the transport of the root and keeps unrelated trees apart", () => {
    const result = roots([post(100, { transportId }), post(101, { parentPostId: id(100) }), post(200, { activityId: activityB }), post(201, { parentPostId: id(200) })]);
    expect(result.get(id(101))).toEqual({ rootPostId: id(100), activityId: null, transportId });
    expect(result.get(id(201))).toEqual({ rootPostId: id(200), activityId: activityB, transportId: null });
  });

  it("prefers the post's own link over the root's", () => {
    const result = roots([post(100, { activityId: activityA }), post(101, { parentPostId: id(100), activityId: activityB })]);
    expect(result.get(id(101))).toEqual({ rootPostId: id(100), activityId: activityB, transportId: null });
  });

  it("treats a root without links as independent and its children too", () => {
    const result = roots([post(100), post(101, { parentPostId: id(100) })]);
    expect(result.get(id(101))).toEqual({ rootPostId: id(100), activityId: null, transportId: null });
  });

  it("treats a cycle as no chain: each post is its own root", () => {
    const result = roots([post(100, { parentPostId: id(101), activityId: activityA }), post(101, { parentPostId: id(100) }),
      post(102, { parentPostId: id(101) }), post(103, { parentPostId: id(103) })]);
    expect(result.get(id(100))).toEqual({ rootPostId: id(100), activityId: activityA, transportId: null });
    expect(result.get(id(101))).toEqual({ rootPostId: id(101), activityId: null, transportId: null });
    expect(result.get(id(102))).toEqual({ rootPostId: id(102), activityId: null, transportId: null });
    expect(result.get(id(103))).toEqual({ rootPostId: id(103), activityId: null, transportId: null });
  });

  it("treats a missing parent as no chain for the post and its descendants, not for healthy posts", () => {
    const result = roots([post(100, { parentPostId: id(999) }), post(101, { parentPostId: id(100) }), post(200, { activityId: activityA }),
      post(201, { parentPostId: id(200) })]);
    expect(result.get(id(100))!.rootPostId).toBe(id(100));
    expect(result.get(id(101))).toEqual({ rootPostId: id(101), activityId: null, transportId: null });
    expect(result.get(id(201))!.activityId).toBe(activityA);
  });

  it("treats a chain deeper than the technical bound as no chain, and exactly the bound as a chain", () => {
    const chain = (length: number) => Array.from({ length }, (_, index) => post(1000 + index,
      index === 0 ? { activityId: activityA } : { parentPostId: id(1000 + index - 1) }));
    const result = roots(chain(MAX_POST_CHAIN_DEPTH + 2));
    // Depth = number of ancestors: index MAX has MAX ancestors (still valid); index MAX+1 has one more.
    expect(result.get(id(1000 + MAX_POST_CHAIN_DEPTH))).toEqual({ rootPostId: id(1000), activityId: activityA, transportId: null });
    expect(result.get(id(1000 + MAX_POST_CHAIN_DEPTH + 1))).toEqual({ rootPostId: id(1000 + MAX_POST_CHAIN_DEPTH + 1), activityId: null, transportId: null });
  });

  it("resolves a long chain without repeating the walk for every post", () => {
    const length = 20_000;
    const posts = Array.from({ length }, (_, index) => post(1000 + index, index % 500 === 0 ? { activityId: activityA } : { parentPostId: id(1000 + index - 1) }));
    const result = roots(posts);
    expect(result.size).toBe(length);
    expect(result.get(id(1000 + 499))!.rootPostId).toBe(id(1000));
    expect(result.get(id(1000 + 500 * 7 + 3))).toEqual({ rootPostId: id(1000 + 500 * 7), activityId: activityA, transportId: null });
  });

  it("matches the roots the itinerary reports for the same snapshot", async () => {
    const day = { id: id(4), tripId, destinationId, date: at(0), type: "activity" as const, startsAt: at(10), endsAt: at(18), order: 2 };
    const activity = (activityId: ObjectId) => ({ id: activityId, tripId, dayId: day.id, title: "Paseo", description: null, scheduledAt: at(12),
      durationMinutes: null, mapsUrl: null, createdBy: actor, createdAt: at(9) });
    const posts = [post(100, { activityId: activityA }), post(101, { parentPostId: id(100) }), post(102, { parentPostId: id(101) }),
      post(103, { parentPostId: id(100), }), post(110, { transportId }), post(111, { parentPostId: id(110) }), post(120),
      post(121, { parentPostId: id(120) }), post(130, { parentPostId: id(999) }), post(131, { parentPostId: id(130) }),
      post(140, { parentPostId: id(141) }), post(141, { parentPostId: id(140) }), post(150, { activityId: activityB }),
      post(151, { parentPostId: id(150) }), post(152, { parentPostId: id(151) }), post(160, { activityId: activityA, parentPostId: null })];
    const snapshot: TripItinerarySnapshot = { trip: { id: tripId, expenseMode: "register" },
      destinations: [{ id: destinationId, tripId, name: "Córdoba", order: 1, createdAt: at(0) }],
      days: [day, { ...day, id: id(5), type: "transit_out", startsAt: at(8), endsAt: at(10), order: 1 }],
      transports: [{ id: transportId, tripId, destinationId, direction: "outbound", type: "car", departurePlace: "Origen", arrivalPlace: "Córdoba",
        departureAt: at(8), arrivalAt: at(10), costPerPerson: 1, details: {} } as never],
      activities: [activity(activityA), activity(activityB)], posts, expenses: [] };
    const itinerary = await getTripItinerary.execute({
      members: { findByTripAndUser: async () => ok({ id: id(9), tripId, userId: actor, role: "participant" as const, joinedAt: at(0) }) },
      itinerary: { read: async () => ok(snapshot) } }, { tripId, authenticatedUserId: actor });
    expect(itinerary.ok).toBe(true);
    if (!itinerary.ok) return;
    const reported = [...itinerary.value.posts, ...itinerary.value.unplacedPosts];
    expect(reported).toHaveLength(posts.length);
    const result = roots(posts);
    for (const item of reported) {
      expect(result.get(item.id), String(item.id)).toEqual({ rootPostId: item.context.rootPostId, activityId: item.context.rootActivityId,
        transportId: item.context.rootTransportId });
    }
  });
});
