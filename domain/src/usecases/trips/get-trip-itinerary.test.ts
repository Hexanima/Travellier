import { describe, expect, it } from "vitest";
import * as domain from "../../index.js";
import type { TripItinerarySnapshot } from "../../types/trip-itinerary.js";

const id = (n: number) => {
  const result = domain.createObjectId(n.toString(16).padStart(24, "0"));
  if (!result.ok) throw result.error;
  return result.value;
};
const tripId = id(1), actor = id(2), destinationId = id(3);
const time = (hour: number) => new Date(`2026-09-25T${String(hour).padStart(2, "0")}:00:00.123Z`);
function fixture() {
  const day = { id: id(4), tripId, destinationId, date: time(0), type: "activity" as const, startsAt: time(10), endsAt: time(18), order: 2 };
  const transport = { id: id(5), tripId, destinationId, direction: "outbound" as const, type: "car" as const,
    departurePlace: "Origen", arrivalPlace: "Córdoba", departureAt: time(8), arrivalAt: time(10), costPerPerson: 999, details: {} };
  const activity = { id: id(6), tripId, dayId: day.id, title: "Paseo", description: null, scheduledAt: time(12), mapsUrl: null,
    status: "confirmed" as const, createdBy: actor, createdAt: time(17) };
  const post = { id: id(7), tripId, dayId: day.id, authorId: actor, description: null, mapsUrl: null,
    activityId: null, transportId: null, parentPostId: null, createdAt: time(13) };
  const snapshot: TripItinerarySnapshot = { trip: { id: tripId, expenseMode: "register", votingEnabled: false },
    destinations: [{ id: destinationId, tripId, name: "Córdoba", order: 1, createdAt: time(0) }],
    days: [day, { ...day, id: id(8), type: "transit_out", startsAt: time(8), endsAt: time(10), order: 1 }],
    transports: [transport], activities: [activity], posts: [post], expenses: [] };
  let reads = 0;
  const dependencies: domain.GetTripItineraryDependencies = { members: { findByTripAndUser: async () => domain.ok({ id: id(9), tripId, userId: actor,
    role: "participant" as const, joinedAt: time(0) }) }, itinerary: { read: async () => { reads++; return domain.ok(snapshot); } } };
  const execute = () => {
    expect(domain.getTripItinerary, "aggregate itinerary use case is available").toBeDefined();
    return domain.getTripItinerary.execute(dependencies, { tripId, authenticatedUserId: actor });
  };
  return { snapshot, dependencies, execute, day, transport, activity, post, reads: () => reads };
}

describe("getTripItinerary", () => {
  it.each(["admin", "participant"] as const)("allows %s and orders persisted slices without merging dates", async (role) => {
    const f = fixture();
    f.dependencies.members.findByTripAndUser = async () => domain.ok({ id: id(9), tripId, userId: actor, role, joinedAt: time(0) });
    const result = await f.execute();
    expect(result).toMatchObject({ ok: true, value: { days: [{ id: id(8), order: 1 }, { id: id(4), order: 2 }] } });
    expect(f.reads()).toBe(1);
  });

  it("does not read content for a non-member", async () => {
    const f = fixture();
    f.dependencies.members.findByTripAndUser = async () => domain.ok(undefined) as never;
    expect(await f.execute()).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(f.reads()).toBe(0);
  });

  it("does not accept a membership of another Trip or user", async () => {
    const f = fixture();
    f.dependencies.members.findByTripAndUser = async () => domain.ok({ id: id(9), tripId: id(80), userId: actor, role: "participant", joinedAt: time(0) });
    expect(await f.execute()).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(f.reads()).toBe(0);
  });

  it("returns not found when the Trip no longer exists", async () => {
    const f = fixture();
    f.dependencies.itinerary.read = async () => domain.ok(undefined) as never;
    expect(await f.execute()).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
  });

  it.each(["membership", "read"])("propagates %s errors without a partial result", async (source) => {
    const f = fixture();
    const failure = domain.err(new domain.UnknownError("unavailable"));
    if (source === "membership") f.dependencies.members.findByTripAndUser = async () => failure as never;
    else f.dependencies.itinerary.read = async () => failure as never;
    expect(await f.execute()).toEqual(failure);
  });

  it("returns an empty itinerary for an unconfigured Trip", async () => {
    const f = fixture();
    Object.assign(f.snapshot, { days: [], transports: [], activities: [], posts: [], expenses: [] });
    expect(await f.execute()).toMatchObject({ ok: true, value: { tripId, days: [], transports: [], activities: [], posts: [] } });
  });

  it("orders activities by scheduledAt and spontaneous posts by publication with stable ties", async () => {
    const f = fixture();
    f.snapshot.activities.unshift({ ...f.activity, id: id(10), scheduledAt: time(11), createdAt: time(18) });
    f.snapshot.posts.unshift({ ...f.post, id: id(11), createdAt: time(12) }, { ...f.post, id: id(12), createdAt: time(13) });
    const result = await f.execute();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.days[1]!.items.map(({ kind, id }) => [kind, id])).toEqual([
      ["activity", id(10)], ["activity", id(6)], ["post", id(11)], ["post", id(7)], ["post", id(12)],
    ]);
    expect(result.value.activities.map(({ id }) => id)).toEqual([id(10), id(6)]);
  });

  it("preserves independent activity, transport and parent links without duplicating posts", async () => {
    const f = fixture();
    f.snapshot.posts.push({ ...f.post, id: id(10), activityId: f.activity.id, transportId: f.transport.id,
      parentPostId: f.post.id, createdAt: time(14) });
    f.snapshot.posts.push({ ...f.post, id: id(11), dayId: id(8), transportId: f.transport.id, createdAt: time(9) });
    const result = await f.execute();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.activities[0]!.postIds).toEqual([id(10)]);
    expect(result.value.transports[0]!.postIds).toEqual([id(11), id(10)]);
    expect(result.value.posts).toHaveLength(3);
    expect(result.value.posts.find((p) => p.id === id(10))).toMatchObject({ activityId: id(6), transportId: id(5), parentPostId: id(7), dayId: id(4) });
    expect(result.value.days[1]!.items.filter((item) => item.kind === "post").map((item) => item.id)).toEqual([id(7)]);
  });

  it("retains dayId for a late publication and sums each expense once in both modes", async () => {
    const f = fixture();
    f.snapshot.posts[0] = { ...f.post, activityId: f.activity.id, transportId: f.transport.id, createdAt: new Date("2026-10-03T12:00:00.789Z") };
    f.snapshot.posts.push({ ...f.post, id: id(10), createdAt: time(11) });
    f.snapshot.expenses = [
      { id: id(20), tripId, postId: f.post.id, totalAmount: 0.1, breakdown: null, paidBy: null, createdAt: time(14) },
      { id: id(21), tripId, postId: id(10), totalAmount: 0.2, breakdown: "agua", paidBy: actor, createdAt: time(14) },
    ];
    for (const mode of ["register", "balance"] as const) {
      f.snapshot.trip.expenseMode = mode;
      const result = await f.execute();
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value.expenseMode).toBe(mode);
      expect(result.value.days[1]!.expenseSummary.totalAmount).toBeCloseTo(0.3);
      expect(result.value.days[1]!.expenseSummary.expenseCount).toBe(2);
      expect(result.value.days[0]!.expenseSummary).toEqual({ totalAmount: 0, expenseCount: 0 });
      expect(result.value.posts.find((p) => p.id === f.post.id)).toMatchObject({ dayId: f.day.id, createdAt: f.snapshot.posts[0]!.createdAt });
    }
  });

  it("keeps multi-day transports in their own destination and direction", async () => {
    const f = fixture();
    f.snapshot.transports[0] = { ...f.transport, departureAt: new Date("2026-09-24T20:00:00.123Z") };
    f.snapshot.days.unshift({ ...f.snapshot.days[1]!, id: id(11), date: new Date("2026-09-24T00:00:00Z"),
      startsAt: new Date("2026-09-24T20:00:00.123Z"), endsAt: new Date("2026-09-25T00:00:00Z"), order: 0 });
    f.snapshot.destinations.push({ ...f.snapshot.destinations[0]!, id: id(30), order: 2 });
    f.snapshot.transports.push({ ...f.transport, id: id(31), destinationId: id(30), direction: "return" });
    const result = await f.execute();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.days[0]!.items).toEqual([{ kind: "transport", id: id(5), at: new Date("2026-09-24T20:00:00.123Z") }]);
    expect(result.value.days[1]!.items).toEqual([{ kind: "transport", id: id(5), at: time(8) }]);
  });

  it("preserves arrival and null bounds without inferring a transport", async () => {
    const f = fixture();
    f.snapshot.days[0] = { ...f.day, type: "arrival", endsAt: null };
    f.snapshot.activities = []; f.snapshot.posts = [];
    const result = await f.execute();
    expect(result).toMatchObject({ ok: true, value: { days: [{ items: [{ kind: "transport", id: id(5) }] }, { type: "arrival", endsAt: null, items: [] }] } });
  });

  it("does not expand cyclic parent links or include foreign data and expenses", async () => {
    const f = fixture();
    f.snapshot.posts[0] = { ...f.post, parentPostId: id(10) };
    f.snapshot.posts.push({ ...f.post, id: id(10), parentPostId: id(7) }, { ...f.post, id: id(40), tripId: id(99) });
    f.snapshot.activities.push({ ...f.activity, id: id(41), tripId: id(99) });
    f.snapshot.expenses.push({ id: id(42), postId: id(7), tripId: id(99), totalAmount: 800, breakdown: null, paidBy: null, createdAt: time(14) });
    const result = await f.execute();
    expect(result).toMatchObject({ ok: true, value: { posts: [{ id: id(7), parentPostId: id(10), expense: null }, { id: id(10), parentPostId: id(7), expense: null }],
      activities: [{ id: id(6) }], days: [{ expenseSummary: { totalAmount: 0 } }, { expenseSummary: { totalAmount: 0 } }] } });
  });
});
