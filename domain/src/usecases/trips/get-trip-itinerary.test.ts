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
  const activity = { id: id(6), tripId, dayId: day.id, title: "Paseo", description: null, scheduledAt: time(12), durationMinutes: null, mapsUrl: null,
    createdBy: actor, createdAt: time(17) };
  const post = { id: id(7), tripId, dayId: day.id, authorId: actor, description: null, mapsUrl: null,
    activityId: null, transportId: null, parentPostId: null, createdAt: time(13) };
  const snapshot: TripItinerarySnapshot = { trip: { id: tripId, expenseMode: "register" },
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
  it("does not expose a voting configuration", async () => {
    const result = await fixture().execute();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).not.toHaveProperty("votingEnabled");
  });
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

  it("preserves null bounds without inferring a transport", async () => {
    const f = fixture();
    f.snapshot.days[0] = { ...f.day, type: "activity", endsAt: null };
    f.snapshot.activities = []; f.snapshot.posts = [];
    const result = await f.execute();
    expect(result).toMatchObject({ ok: true, value: { days: [{ items: [{ kind: "transport", id: id(5) }] }, { type: "activity", endsAt: null, items: [] }] } });
  });

  it("does not expand cyclic parent links or include foreign data and expenses", async () => {
    const f = fixture();
    f.snapshot.posts[0] = { ...f.post, parentPostId: id(10) };
    f.snapshot.posts.push({ ...f.post, id: id(10), parentPostId: id(7) }, { ...f.post, id: id(40), tripId: id(99) });
    f.snapshot.activities.push({ ...f.activity, id: id(41), tripId: id(99) });
    f.snapshot.expenses.push({ id: id(42), postId: id(7), tripId: id(99), totalAmount: 800, currency: "ARS", breakdown: null, paidBy: null, createdAt: time(14) });
    const result = await f.execute();
    expect(result).toMatchObject({ ok: true, value: { posts: [{ id: id(7), parentPostId: id(10), expense: null }, { id: id(10), parentPostId: id(7), expense: null }],
      activities: [{ id: id(6) }], days: [{ expenseSummary: { expenseCount: 0 } }, { expenseSummary: { expenseCount: 0 } }], expenses: [] } });
  });
});

describe("getTripItinerary projection of memories by context (T56)", () => {
  const iso = (value: string) => new Date(value);
  const fresh = () => { const f = fixture(); f.snapshot.posts = []; return f; };
  const mk = (f: ReturnType<typeof fixture>, n: number, fields: Record<string, unknown> = {}) => {
    const base = { ...f.post } as Record<string, unknown>;
    delete base.dayId;
    f.snapshot.posts.push({ ...base, id: id(n), createdAt: time(13), ...fields } as never);
  };
  const run = async (f: ReturnType<typeof fixture>) => {
    const result = await f.execute();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unexpected");
    return result.value;
  };
  const expense = (n: number, postId: domain.ObjectId, totalAmount: number, currency: domain.Currency | null = "ARS") =>
    ({ id: id(n), tripId, postId, totalAmount, currency, breakdown: null, paidBy: null, createdAt: time(14) });
  /** Same invariants the current web validator enforces over the response. */
  const expectCompatible = (value: domain.TripItinerary) => {
    const dayIds = new Set(value.days.map((day) => day.id)), postIds = new Set(value.posts.map((post) => post.id));
    const activityIds = new Set(value.activities.map((a) => a.id)), transportIds = new Set(value.transports.map((t) => t.id));
    for (const post of value.posts) {
      expect(dayIds.has(post.dayId)).toBe(true);
      if (post.parentPostId !== null) expect(postIds.has(post.parentPostId)).toBe(true);
      if (post.activityId !== null) expect(activityIds.has(post.activityId)).toBe(true);
      if (post.transportId !== null) expect(transportIds.has(post.transportId)).toBe(true);
    }
    for (const owner of [...value.activities, ...value.transports]) for (const postId of owner.postIds) expect(postIds.has(postId)).toBe(true);
    for (const day of value.days) for (const item of day.items) if (item.kind === "post") expect(postIds.has(item.id)).toBe(true);
    const all = [...value.posts, ...value.unplacedPosts].map((post) => post.id);
    expect(new Set(all).size).toBe(all.length);
  };

  it("projects a post without dayId by its publication slice with context", async () => {
    const f = fresh(); mk(f, 10, { createdAt: time(11) });
    const value = await run(f);
    expect(value.posts.map((p) => p.id)).toEqual([id(10)]);
    expect(value.posts[0]).toMatchObject({ dayId: f.day.id, context: { parentPostId: null, rootPostId: id(10), rootActivityId: null, rootTransportId: null, placement: "independent" } });
    expect(value.days[1]!.items.filter((i) => i.kind === "post")).toEqual([{ kind: "post", id: id(10), at: time(11) }]);
    expect(value.unplacedPosts).toEqual([]);
    expectCompatible(value);
  });

  it("includes direct and nested descendants published later outside the itinerary without duplicating them as independents", async () => {
    const f = fresh();
    mk(f, 10, { activityId: f.activity.id, createdAt: time(13) });
    mk(f, 11, { parentPostId: id(10), createdAt: iso("2026-10-03T12:00:00.789Z") });
    mk(f, 12, { parentPostId: id(11), createdAt: iso("2026-10-04T12:00:00.001Z") });
    const value = await run(f);
    expect(value.activities[0]!.postIds).toEqual([id(10), id(11), id(12)]);
    expect(value.posts.map((p) => [p.id, p.dayId, p.context.placement, p.context.rootActivityId, p.context.rootPostId])).toEqual([
      [id(10), f.day.id, "activity", f.activity.id, id(10)], [id(11), f.day.id, "activity", f.activity.id, id(10)],
      [id(12), f.day.id, "activity", f.activity.id, id(10)]]);
    expect(value.posts.find((p) => p.id === id(12))).toMatchObject({ parentPostId: id(11), context: { parentPostId: id(11) } });
    expect(value.unplacedPosts).toEqual([]);
    expect(value.days.flatMap((d) => d.items).filter((i) => i.kind === "post")).toEqual([]);
    expectCompatible(value);
  });

  it("handles branches under the same root activity without duplicates", async () => {
    const f = fresh();
    mk(f, 10, { activityId: f.activity.id }); mk(f, 11, { parentPostId: id(10), createdAt: time(14) });
    mk(f, 12, { parentPostId: id(11), createdAt: time(15) }); mk(f, 13, { parentPostId: id(11), createdAt: time(16) });
    mk(f, 14, { parentPostId: id(10), createdAt: time(15) });
    const value = await run(f);
    expect(value.activities[0]!.postIds).toEqual([id(10), id(11), id(12), id(14), id(13)]);
    expect(value.posts).toHaveLength(5);
    expectCompatible(value);
  });

  it("projects transport posts and descendants published later into transports.postIds without independent items", async () => {
    const f = fresh();
    mk(f, 10, { transportId: f.transport.id, createdAt: iso("2026-09-26T09:00:00.000Z") });
    mk(f, 11, { parentPostId: id(10), createdAt: iso("2026-10-01T09:00:00.000Z") });
    const value = await run(f);
    expect(value.transports[0]!.postIds).toEqual([id(10), id(11)]);
    expect(value.posts.map((p) => [p.id, p.dayId, p.context.placement, p.context.rootTransportId])).toEqual([
      [id(10), id(8), "transport", f.transport.id], [id(11), id(8), "transport", f.transport.id]]);
    expect(value.days.flatMap((d) => d.items).filter((i) => i.kind === "post")).toEqual([]);
    expectCompatible(value);
  });

  it("sends a post outside every slice and date to unplacedPosts with its expense, outside postIds and summaries", async () => {
    const f = fresh(); mk(f, 10, { createdAt: iso("2026-11-01T10:00:00.000Z") });
    f.snapshot.expenses = [expense(20, id(10), 7)];
    const value = await run(f);
    expect(value.posts).toEqual([]);
    expect(value.unplacedPosts).toMatchObject([{ id: id(10), dayId: null, expense: { totalAmount: 7 }, context: { placement: "independent", rootPostId: id(10) } }]);
    for (const day of value.days) { expect(day.items.some((i) => i.id === id(10))).toBe(false); expect(day.expenseSummary.expenseCount).toBe(0); }
    expectCompatible(value);
  });

  it("keeps every post of a Trip without itinerary", async () => {
    const f = fresh();
    Object.assign(f.snapshot, { days: [], transports: [], activities: [], destinations: [], expenses: [] });
    mk(f, 10, { createdAt: time(11) }); mk(f, 11, { parentPostId: id(10) });
    const value = await run(f);
    expect(value.posts).toEqual([]);
    expect(value.unplacedPosts.map((p) => [p.id, p.parentPostId, p.context.parentPostId])).toEqual([[id(10), null, null], [id(11), id(10), id(10)]]);
  });

  it("projects intermediate days, a post inside one and a post after the trip", async () => {
    const f = fresh();
    const mid = { ...f.day, id: id(50), type: "activity" as const, date: iso("2026-09-26T00:00:00.000Z"), startsAt: iso("2026-09-26T00:00:00.000Z"), endsAt: iso("2026-09-27T00:00:00.000Z"), order: 3 };
    f.snapshot.days.push(mid);
    const empty = await run(f);
    expect(empty.days.find((d) => d.id === id(50))!.items).toEqual([]);
    mk(f, 10, { createdAt: iso("2026-09-26T15:00:00.000Z") }); mk(f, 11, { createdAt: iso("2026-09-28T15:00:00.000Z") });
    const value = await run(f);
    expect(value.days.find((d) => d.id === id(50))!.items).toEqual([{ kind: "post", id: id(10), at: iso("2026-09-26T15:00:00.000Z") }]);
    expect(value.unplacedPosts.map((p) => p.id)).toEqual([id(11)]);
    expectCompatible(value);
  });

  it("uses an inclusive start, exclusive end and preserves milliseconds", async () => {
    const f = fresh();
    mk(f, 10, { createdAt: time(10) }); mk(f, 11, { createdAt: iso("2026-09-25T09:59:59.999Z") });
    const value = await run(f);
    expect(value.posts.find((p) => p.id === id(10))).toMatchObject({ dayId: f.day.id, createdAt: time(10) });
    expect(value.posts.find((p) => p.id === id(11))).toMatchObject({ dayId: id(8), createdAt: iso("2026-09-25T09:59:59.999Z") });
    expect(value.days[0]!.items.map((i) => [i.kind, i.id, i.at.toISOString()])).toEqual([
      ["transport", id(5), time(8).toISOString()], ["post", id(11), "2026-09-25T09:59:59.999Z"]]);
  });

  it("anchors a post in a gap of the same UTC date to the lowest-order slice", async () => {
    const f = fresh();
    f.snapshot.days[0] = { ...f.day, startsAt: time(10), endsAt: time(12) };
    mk(f, 10, { createdAt: time(15) }); mk(f, 11, { createdAt: time(5) });
    const value = await run(f);
    expect(value.posts.map((p) => [p.id, p.dayId])).toEqual([[id(11), id(8)], [id(10), id(8)]]);
  });

  it("assigns slices that share a date by instant", async () => {
    const f = fresh();
    mk(f, 10, { createdAt: time(9) }); mk(f, 11, { createdAt: time(11) });
    const value = await run(f);
    expect(value.posts.map((p) => [p.id, p.dayId])).toEqual([[id(10), id(8)], [id(11), f.day.id]]);
  });

  it("sums each expense once by effective activity day or publication slice", async () => {
    const f = fresh();
    mk(f, 10, { activityId: f.activity.id, createdAt: time(13) });
    mk(f, 11, { parentPostId: id(10), createdAt: iso("2026-10-03T12:00:00.000Z") });
    mk(f, 12, { createdAt: time(9) });
    mk(f, 13, { transportId: f.transport.id, createdAt: time(9) });
    f.snapshot.expenses = [expense(20, id(11), 1), expense(21, id(12), 2), expense(22, id(13), 4)];
    for (const mode of ["register", "balance"] as const) {
      f.snapshot.trip.expenseMode = mode;
      const value = await run(f);
      expect(value.days[1]!.expenseSummary).toEqual({ byCurrency: [{ currency: "ARS", totalCents: 100, expenseCount: 1 }], withoutCurrency: { expenseCount: 0 }, expenseCount: 1 });
      expect(value.days[0]!.expenseSummary).toEqual({ byCurrency: [{ currency: "ARS", totalCents: 600, expenseCount: 2 }], withoutCurrency: { expenseCount: 0 }, expenseCount: 2 });
    }
  });

  it("orders items and postIds stably by instant and id", async () => {
    const f = fresh();
    mk(f, 12, { activityId: f.activity.id, createdAt: time(14) }); mk(f, 11, { activityId: f.activity.id, createdAt: time(14) });
    mk(f, 14, { createdAt: time(12) });
    mk(f, 13, { createdAt: time(12) });
    const value = await run(f);
    expect(value.activities[0]!.postIds).toEqual([id(11), id(12)]);
    expect(value.days[1]!.items.map((i) => [i.kind, i.id])).toEqual([["activity", id(6)], ["post", id(13)], ["post", id(14)]]);
  });

  it("does not throw, expand or duplicate for cycles, a missing parent or a parent of another Trip", async () => {
    const f = fresh();
    mk(f, 10, { parentPostId: id(11) }); mk(f, 11, { parentPostId: id(10) });
    mk(f, 12, { parentPostId: id(77), createdAt: time(14) });
    f.snapshot.posts.push({ ...(f.post as object), dayId: null, id: id(78), tripId: id(99), activityId: f.activity.id } as never);
    mk(f, 13, { parentPostId: id(78), createdAt: time(15) });
    const value = await run(f);
    expect(value.posts.map((p) => p.id)).toEqual([id(10), id(11), id(12), id(13)]);
    expect(value.activities[0]!.postIds).toEqual([]);
    for (const post of value.posts) expect(post.context).toMatchObject({ rootPostId: post.id, placement: "independent" });
    expectCompatible(value);
  });

  it("nulls the compatible parent link when the parent is unplaced but keeps it in context", async () => {
    const f = fresh();
    mk(f, 10, { createdAt: iso("2026-12-01T00:00:00.000Z") });
    mk(f, 11, { parentPostId: id(10), createdAt: time(11) });
    const value = await run(f);
    expect(value.unplacedPosts.map((p) => p.id)).toEqual([id(10)]);
    expect(value.posts).toMatchObject([{ id: id(11), parentPostId: null, context: { parentPostId: id(10), rootPostId: id(10), placement: "independent" } }]);
    expectCompatible(value);
  });

  it("does not depend on the process time zone: a gap instant near UTC midnight anchors by UTC date", async () => {
    const f = fresh();
    f.snapshot.days = [{ ...f.day, id: id(61), date: iso("2026-09-25T00:00:00.000Z"), startsAt: iso("2026-09-25T00:00:00.000Z"), endsAt: iso("2026-09-26T00:00:00.000Z"), order: 1 },
      { ...f.day, id: id(60), date: iso("2026-09-26T00:00:00.000Z"), startsAt: iso("2026-09-26T10:00:00.000Z"), endsAt: iso("2026-09-26T20:00:00.000Z"), order: 2 }];
    f.snapshot.activities = []; f.snapshot.transports = [];
    const instants = [iso("2026-09-26T02:30:00.123Z"), iso("2026-09-26T20:30:00.456Z")];
    instants.forEach((createdAt, index) => mk(f, 10 + index, { createdAt }));
    const previous = process.env.TZ;
    try {
      for (const zone of ["Pacific/Kiritimati", "America/Argentina/Buenos_Aires", "UTC"]) {
        process.env.TZ = zone;
        // 02:30Z is 25/09 in Buenos Aires and 20:30Z is 27/09 in Kiritimati: only a UTC fallback gives the same answer everywhere.
        for (const instant of instants) expect(domain.dayForInstant(f.snapshot.days, instant)?.id, zone + instant.toISOString()).toBe(id(60));
        const value = await run(f);
        expect(value.posts.map((p) => [p.id, p.dayId, p.createdAt.toISOString()]), zone).toEqual([
          [id(10), id(60), "2026-09-26T02:30:00.123Z"], [id(11), id(60), "2026-09-26T20:30:00.456Z"]]);
        expect(value.unplacedPosts, zone).toEqual([]);
      }
    } finally {
      if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
    }
  });

  it("keeps a transport post published outside every slice in its transit day without summing its expense", async () => {
    const f = fresh();
    mk(f, 10, { transportId: f.transport.id, createdAt: iso("2026-11-01T10:00:00.000Z") });
    f.snapshot.expenses = [expense(20, id(10), 9)];
    const value = await run(f);
    expect(value.posts).toMatchObject([{ id: id(10), dayId: id(8), expense: { totalAmount: 9 }, context: { placement: "transport", rootTransportId: f.transport.id } }]);
    expect(value.unplacedPosts).toEqual([]);
    expect(value.transports[0]!.postIds).toEqual([id(10)]);
    for (const day of value.days) expect(day.expenseSummary).toMatchObject({ byCurrency: [], expenseCount: 0 });
    expect(value.expenseSummary.outsideItinerary).toMatchObject({ expenseCount: 1, byCurrency: [{ currency: "ARS", totalCents: 900 }] });
    expectCompatible(value);
  });

  it("does not throw or duplicate for a chain deeper than MAX_POST_CHAIN_DEPTH and projects the too-deep link as independent", async () => {
    const f = fresh();
    const levels = domain.MAX_POST_CHAIN_DEPTH + 1, first = 5000;
    mk(f, first, { activityId: f.activity.id });
    for (let level = 1; level <= levels; level++) mk(f, first + level, { parentPostId: id(first + level - 1) });
    const value = await run(f);
    const deepest = id(first + levels), reachable = id(first + levels - 1);
    expect(value.posts).toHaveLength(levels + 1);
    expect(new Set(value.posts.map((p) => p.id)).size).toBe(levels + 1);
    expect(value.unplacedPosts).toEqual([]);
    expect(value.posts.find((p) => p.id === reachable)).toMatchObject({ context: { placement: "activity", rootPostId: id(first), rootActivityId: f.activity.id } });
    expect(value.posts.find((p) => p.id === deepest)).toMatchObject({ parentPostId: reachable, activityId: null,
      context: { placement: "independent", rootPostId: deepest, rootActivityId: null, parentPostId: reachable } });
    expect(value.activities[0]!.postIds).toHaveLength(levels);
    expect(value.activities[0]!.postIds).not.toContain(deepest);
    expect(value.days[1]!.items.filter((i) => i.kind === "post").map((i) => i.id)).toEqual([deepest]);
    expectCompatible(value);
  });
});

describe("getTripItinerary expense projection (T81)", () => {
  const iso = (value: string) => new Date(value);
  const fresh = () => { const f = fixture(); f.snapshot.posts = []; return f; };
  const mk = (f: ReturnType<typeof fixture>, n: number, fields: Record<string, unknown> = {}) => {
    const base = { ...f.post } as Record<string, unknown>;
    delete base.dayId;
    f.snapshot.posts.push({ ...base, id: id(n), createdAt: time(13), ...fields } as never);
  };
  const expense = (n: number, postId: domain.ObjectId, totalAmount: number, currency: domain.Currency | null = "ARS") =>
    ({ id: id(n), tripId, postId, totalAmount, currency, breakdown: null, paidBy: null, createdAt: time(14) });
  const run = async (f: ReturnType<typeof fixture>) => {
    const result = await f.execute();
    if (!result.ok) throw new Error("unexpected");
    return result.value;
  };
  const ars = (totalCents: number, expenseCount: number) => ({ currency: "ARS", totalCents, expenseCount });

  it("attributes an expense published on a later day to the root activity without changing its publication instant", async () => {
    const f = fresh();
    mk(f, 10, { activityId: f.activity.id });
    mk(f, 11, { parentPostId: id(10), createdAt: iso("2026-10-03T12:00:00.987Z") });
    f.snapshot.expenses = [expense(20, id(11), 12.5)];
    const value = await run(f);
    expect(value.expenses).toEqual([{ expenseId: id(20), postId: id(11), rootPostId: id(10), source: "activity", rootActivityId: f.activity.id,
      occurredAt: f.activity.scheduledAt, publishedAt: iso("2026-10-03T12:00:00.987Z"), dayId: f.day.id, currency: "ARS", amountCents: 1250 }]);
    expect(value.days[1]!.expenseSummary.byCurrency).toEqual([ars(1250, 1)]);
    expect(value.posts.find((p) => p.id === id(11))!.createdAt.toISOString()).toBe("2026-10-03T12:00:00.987Z");
  });

  it("does not duplicate descendants: each expense counts once on its own and the root chain only attributes", async () => {
    const f = fresh();
    mk(f, 10, { activityId: f.activity.id }); mk(f, 11, { parentPostId: id(10) }); mk(f, 12, { parentPostId: id(11) });
    f.snapshot.expenses = [expense(20, id(10), 1), expense(21, id(11), 2), expense(22, id(12), 4)];
    const value = await run(f);
    expect(value.expenses.map((e) => [e.postId, e.rootPostId, e.amountCents])).toEqual([[id(10), id(10), 100], [id(11), id(10), 200], [id(12), id(10), 400]]);
    expect(value.expenseSummary.byCurrency).toEqual([ars(700, 3)]);
    expect(value.expenseSummary.expenseCount).toBe(3);
  });

  it("moves the expense on relink, keeping the same amount", async () => {
    const f = fresh();
    const second = { ...f.activity, id: id(30), dayId: id(8), scheduledAt: time(9) };
    f.snapshot.activities.push(second);
    mk(f, 10, { activityId: f.activity.id });
    f.snapshot.expenses = [expense(20, id(10), 5)];
    const before = await run(f);
    expect(before.days[1]!.expenseSummary.byCurrency).toEqual([ars(500, 1)]);
    f.snapshot.posts[0] = { ...f.snapshot.posts[0]!, activityId: second.id };
    const after = await run(f);
    expect(after.days[1]!.expenseSummary.byCurrency).toEqual([]);
    expect(after.days[0]!.expenseSummary.byCurrency).toEqual([ars(500, 1)]);
    expect(after.expenses[0]).toMatchObject({ rootActivityId: second.id, occurredAt: second.scheduledAt, amountCents: 500 });
  });

  it("follows a rescheduled activity and falls back to the own publication when it is deleted, keeping the amount", async () => {
    const f = fresh();
    mk(f, 10, { activityId: f.activity.id, createdAt: time(9) });
    f.snapshot.expenses = [expense(20, id(10), 3)];
    f.snapshot.activities[0] = { ...f.activity, scheduledAt: time(15) };
    const moved = await run(f);
    expect(moved.expenses[0]).toMatchObject({ source: "activity", occurredAt: time(15), publishedAt: time(9), amountCents: 300 });
    f.snapshot.activities = [];
    const removed = await run(f);
    expect(removed.expenses[0]).toMatchObject({ source: "publication", rootActivityId: null, occurredAt: time(9), dayId: id(8), amountCents: 300 });
    expect(removed.days[0]!.expenseSummary.byCurrency).toEqual([ars(300, 1)]);
  });

  it("uses publication for a broken or cyclic chain", async () => {
    const f = fresh();
    mk(f, 10, { parentPostId: id(11), createdAt: time(9) }); mk(f, 11, { parentPostId: id(10), createdAt: time(9) });
    mk(f, 12, { parentPostId: id(999), createdAt: time(9) });
    f.snapshot.expenses = [expense(20, id(10), 1), expense(21, id(12), 1)];
    const value = await run(f);
    expect(value.expenses.map((e) => [e.rootPostId, e.source])).toEqual([[id(10), "publication"], [id(12), "publication"]]);
  });

  it("totals the Trip as days plus outside the itinerary, per currency, without a single total", async () => {
    const f = fresh();
    mk(f, 10, { activityId: f.activity.id }); mk(f, 11, { createdAt: iso("2026-11-01T10:00:00.000Z") });
    mk(f, 12, { activityId: f.activity.id }); mk(f, 13, { activityId: f.activity.id });
    f.snapshot.expenses = [expense(20, id(10), 0.1), expense(21, id(11), 7, "USD"), expense(22, id(12), 0.2), expense(23, id(13), 3, "EUR")];
    const value = await run(f);
    expect(value.days[1]!.expenseSummary).toMatchObject({ byCurrency: [ars(30, 2), { currency: "EUR", totalCents: 300, expenseCount: 1 }], expenseCount: 3 });
    expect(value.expenseSummary.outsideItinerary).toEqual({ byCurrency: [{ currency: "USD", totalCents: 700, expenseCount: 1 }], withoutCurrency: { expenseCount: 0 }, expenseCount: 1 });
    expect(value.expenseSummary).toMatchObject({ expenseCount: 4, byCurrency: [ars(30, 2), { currency: "EUR", totalCents: 300, expenseCount: 1 }, { currency: "USD", totalCents: 700, expenseCount: 1 }] });
    expect(value.expenseSummary).not.toHaveProperty("totalAmount");
    expect(value.expenses.find((e) => e.postId === id(10))!.dayId).not.toBeNull();
    expect(value.expenses.find((e) => e.postId === id(11))!.dayId).toBeNull();
  });

  it("counts a legacy expense without currency and ignores foreign expenses or missing posts", async () => {
    const f = fresh();
    mk(f, 10, { activityId: f.activity.id });
    f.snapshot.expenses = [expense(20, id(10), 5, null), { ...expense(21, id(10), 9), tripId: id(99) }, expense(22, id(404), 9)];
    const value = await run(f);
    expect(value.expenseSummary).toEqual({ byCurrency: [], withoutCurrency: { expenseCount: 1 }, expenseCount: 1,
      outsideItinerary: { byCurrency: [], withoutCurrency: { expenseCount: 0 }, expenseCount: 0 } });
  });

  it("is empty without expenses", async () => {
    const value = await run(fresh());
    expect(value.expenses).toEqual([]);
    expect(value.expenseSummary.byCurrency).toEqual([]);
  });

  it("orders attributions by occurredAt then id", async () => {
    const f = fresh();
    mk(f, 10, { activityId: f.activity.id }); mk(f, 11, { createdAt: time(9) }); mk(f, 12, { createdAt: time(9) });
    f.snapshot.expenses = [expense(23, id(10), 1), expense(22, id(12), 1), expense(21, id(11), 1)];
    const value = await run(f);
    expect(value.expenses.map((e) => e.expenseId)).toEqual([id(21), id(22), id(23)]);
  });
});
