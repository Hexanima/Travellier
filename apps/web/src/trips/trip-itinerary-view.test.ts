import { describe, expect, it } from "vitest";
import { itineraryFixture, itineraryId } from "./itinerary-test-fixture.js";
import type { TripItineraryResponse } from "./trip-itinerary-api.js";
import { projectTripItinerary } from "./trip-itinerary-view.js";

const fixture = () => itineraryFixture() as TripItineraryResponse;

describe("local itinerary projection", () => {
  it("shows outbound, activity and return bands under the same local date", async () => {
    const project = projectTripItinerary;
    const result = project(fixture(), "America/Argentina/Buenos_Aires");
    expect(result.map((day) => day.date)).toEqual(["2026-09-25"]);
    expect(result[0].segments.map((segment) => segment.type)).toEqual(["transit_out", "activity", "transit_return"]);
    expect(result[0].segments[1].startsAt).toBe("2026-09-25T10:00:00.123Z");
  });
  it("interleaves activities and spontaneous posts by their actual timestamps with stable ties", async () => {
    const project = projectTripItinerary, itinerary = fixture();
    itinerary.activities.reverse(); itinerary.days[1].items.reverse();
    itinerary.posts.push({ ...itinerary.posts[0], id: itineraryId(13), createdAt: itinerary.activities[0].scheduledAt, expense: null });
    itinerary.days[1].items.push({ kind: "post", id: itineraryId(13), at: itinerary.activities[0].scheduledAt });
    const items = project(itinerary, "UTC")[0].segments[1].items;
    expect(items.map((item) => item.id)).toEqual([itineraryId(8), itineraryId(10), itineraryId(9), itineraryId(13)]);
  });
  it("splits a canonical UTC band at local midnight, preserving source IDs and milliseconds", async () => {
    const project = projectTripItinerary, itinerary = fixture();
    itinerary.days = [{ ...itinerary.days[1], startsAt: "2026-09-25T00:00:00.123Z", endsAt: "2026-09-25T08:00:00.456Z", items: [] }];
    itinerary.posts = []; itinerary.activities = []; itinerary.transports = [];
    const days = project(itinerary, "America/Argentina/Buenos_Aires");
    expect(days.map((day) => day.date)).toEqual(["2026-09-24", "2026-09-25"]);
    expect(days[0].segments[0]).toMatchObject({ startsAt: "2026-09-25T00:00:00.123Z", endsAt: "2026-09-25T03:00:00.000Z", sourceDayIds: [itineraryId(4)] });
    expect(days[1].segments[0]).toMatchObject({ startsAt: "2026-09-25T03:00:00.000Z", endsAt: "2026-09-25T08:00:00.456Z", sourceDayIds: [itineraryId(4)] });
  });
  it("merges contiguous UTC slices of the same band in a local calendar day", async () => {
    const project = projectTripItinerary, itinerary = fixture();
    itinerary.days = [
      { ...itinerary.days[1], startsAt: "2026-09-24T22:00:00.000Z", endsAt: "2026-09-25T00:00:00.000Z", items: [] },
      { ...itinerary.days[1], id: itineraryId(30), startsAt: "2026-09-25T00:00:00.000Z", endsAt: "2026-09-25T03:00:00.000Z", items: [] },
    ];
    itinerary.activities = []; itinerary.posts = []; itinerary.transports = [];
    const days = project(itinerary, "America/Argentina/Buenos_Aires");
    expect(days).toHaveLength(1); expect(days[0].segments).toHaveLength(1);
    expect(days[0].segments[0].sourceDayIds).toEqual([itineraryId(4), itineraryId(30)]);
    expect(days[0].segments[0].endsAt).toBe("2026-09-25T03:00:00.000Z");
  });
  it.each([
    ["2026-03-08T05:00:00.000Z", "2026-03-09T04:00:00.000Z", "2026-03-08"],
    ["2026-11-01T04:00:00.000Z", "2026-11-02T05:00:00.000Z", "2026-11-01"],
  ])("uses calendar boundaries across DST: %s", async (startsAt, endsAt, expected) => {
    const project = projectTripItinerary, itinerary = fixture();
    itinerary.days = [{ ...itinerary.days[1], startsAt, endsAt, items: [] }];
    itinerary.activities = []; itinerary.posts = []; itinerary.transports = [];
    const days = project(itinerary, "America/New_York");
    expect(days.map((day) => day.date)).toEqual([expected]);
    expect(days[0].segments[0]).toMatchObject({ startsAt, endsAt });
  });
  it("groups activities by local scheduled time rather than the UTC date field", async () => {
    const project = projectTripItinerary, itinerary = fixture();
    itinerary.days = [{ ...itinerary.days[1], startsAt: "2026-09-25T00:00:00.000Z", endsAt: "2026-09-25T08:00:00.000Z" }];
    itinerary.activities = [
      { ...itinerary.activities[0], scheduledAt: "2026-09-25T02:00:00.000Z" },
      { ...itinerary.activities[1], scheduledAt: "2026-09-25T04:00:00.000Z" },
    ];
    itinerary.posts = []; itinerary.transports = [];
    itinerary.days[0].items = itinerary.activities.map((a) => ({ kind: "activity", id: a.id, at: a.scheduledAt }));
    const days = project(itinerary, "America/Argentina/Buenos_Aires");
    expect(days.map((day) => day.segments[0].items.map((item) => item.id))).toEqual([[itineraryId(8)], [itineraryId(9)]]);
  });
  it.each(["2026-09-25T18:00:00.123Z", "2026-09-26T03:00:00.000Z"])("retains an activity at the final departure boundary: %s", async (endsAt) => {
    const project = projectTripItinerary, itinerary = fixture();
    itinerary.days = [{ ...itinerary.days[1], endsAt }];
    itinerary.activities = [{ ...itinerary.activities[0], scheduledAt: endsAt }];
    itinerary.posts = []; itinerary.transports = [];
    const days = project(itinerary, "America/Argentina/Buenos_Aires");
    const day = days.find((d) => d.date === (endsAt.includes("26T") ? "2026-09-26" : "2026-09-25"));
    expect(day?.segments.flatMap((s) => s.items).map((i) => i.id)).toEqual([itineraryId(8)]);
  });
  it.each(["register", "balance"] as const)("renders an activity-linked post once and counts its expense once in %s", async (expenseMode) => {
    const project = projectTripItinerary, itinerary = fixture();
    itinerary.expenseMode = expenseMode;
    itinerary.posts[0].activityId = itineraryId(8); itinerary.posts[0].transportId = itineraryId(6);
    itinerary.activities[0].postIds = [itineraryId(10)]; itinerary.transports[0].postIds.push(itineraryId(10));
    const day = project(itinerary, "UTC")[0];
    const activities = day.segments.flatMap((s) => s.items).filter((i) => i.kind === "activity");
    expect(activities[0].posts.map((p) => p.id)).toEqual([itineraryId(10)]);
    expect(day.segments.flatMap((s) => s.items).filter((i) => i.kind === "post" && i.id === itineraryId(10))).toHaveLength(0);
    expect(day.expenseSummary).toEqual({ totalAmount: 25.5, expenseCount: 1 });
  });
  it("retains transport context across dates without repeating its posts or expenses", async () => {
    const project = projectTripItinerary, itinerary = fixture();
    itinerary.days = [{ ...itinerary.days[0], startsAt: "2026-09-25T00:00:00.000Z", endsAt: "2026-09-25T10:00:00.123Z" }];
    itinerary.activities = []; itinerary.posts = [itinerary.posts[1]];
    itinerary.posts[0].createdAt = "2026-09-25T04:00:00.000Z";
    itinerary.posts[0].expense = { ...itineraryFixture().posts[0].expense!, postId: itinerary.posts[0].id };
    itinerary.transports = [itinerary.transports[0]]; itinerary.transports[0].departureAt = itinerary.days[0].startsAt;
    const days = project(itinerary, "America/Argentina/Buenos_Aires");
    expect(days.map((day) => day.segments[0].items.filter((item) => item.kind === "transport").map((item) => item.id)))
      .toEqual([[itineraryId(6)], [itineraryId(6)]]);
    expect(days.map((day) => day.expenseSummary.totalAmount)).toEqual([0, 25.5]);
    expect(days.flatMap((day) => day.segments.flatMap((s) => s.items.filter((i) => i.kind === "post")))).toHaveLength(1);
  });
  it("keeps a late spontaneous post and its expense in its assigned band when that band has one local date", async () => {
    const project = projectTripItinerary, itinerary = fixture();
    itinerary.posts[0].createdAt = "2026-10-03T12:00:00.789Z";
    const before = JSON.stringify(itinerary), days = project(itinerary, "America/Argentina/Buenos_Aires");
    expect(days.map((d) => d.date)).toEqual(["2026-09-25"]);
    expect(days[0].segments[1].items.filter((i) => i.kind === "post").map((i) => i.id)).toEqual([itineraryId(10)]);
    expect(days[0].expenseSummary).toEqual({ totalAmount: 25.5, expenseCount: 1 });
    expect(JSON.stringify(itinerary)).toBe(before);
  });
  it.each([
    ["register", "2026-10-03T12:00:00.789Z"],
    ["balance", "2026-10-03T12:00:00.789Z"],
    ["register", "2026-09-24T12:00:00.789Z"],
    ["balance", "2026-09-24T12:00:00.789Z"],
  ] as const)("retains an out-of-band post in a split canonical day: %s, %s", (expenseMode, createdAt) => {
    const itinerary = fixture();
    itinerary.expenseMode = expenseMode;
    itinerary.days = [{ ...itinerary.days[1], startsAt: "2026-09-25T00:00:00.123Z", endsAt: "2026-09-25T08:00:00.456Z", items: [] }];
    itinerary.activities = []; itinerary.transports = []; itinerary.posts = [itinerary.posts[0]];
    itinerary.posts[0].createdAt = createdAt;
    const before = JSON.stringify(itinerary);
    const days = projectTripItinerary(itinerary, "America/Argentina/Buenos_Aires");
    expect(days.map((day) => day.date)).toEqual(["2026-09-24", "2026-09-25"]);
    const posts = days.flatMap((day) => day.segments.flatMap((segment) => segment.items.filter((item) => item.kind === "post")));
    expect(posts).toEqual([{ kind: "post", id: itinerary.posts[0].id, at: createdAt, post: itinerary.posts[0] }]);
    expect(days[0].segments[0].sourceDayIds).toContain(itinerary.posts[0].dayId);
    expect(days.map((day) => day.expenseSummary)).toEqual([
      { totalAmount: 25.5, expenseCount: 1 }, { totalAmount: 0, expenseCount: 0 },
    ]);
    expect(JSON.stringify(itinerary)).toBe(before);
  });
  it.each(["UTC", "America/Argentina/Buenos_Aires"])("nests a post by activityId across canonical days in %s", (timeZone) => {
    const itinerary = fixture();
    itinerary.days = [
      { ...itinerary.days[1], date: "2026-09-24T00:00:00.000Z", startsAt: "2026-09-24T22:00:00.000Z", endsAt: "2026-09-25T00:00:00.000Z", items: [] },
      { ...itinerary.days[1], id: itineraryId(30), startsAt: "2026-09-25T00:00:00.000Z", endsAt: "2026-09-25T03:00:00.000Z", items: [] },
    ];
    itinerary.transports = []; itinerary.activities = [itinerary.activities[0]]; itinerary.posts = [itinerary.posts[0]];
    itinerary.activities[0].scheduledAt = "2026-09-24T23:00:00.000Z";
    itinerary.activities[0].postIds = [itinerary.posts[0].id];
    itinerary.posts[0].dayId = itineraryId(30); itinerary.posts[0].activityId = itinerary.activities[0].id;
    itinerary.posts[0].createdAt = "2026-09-25T01:00:00.000Z";
    const before = JSON.stringify(itinerary), days = projectTripItinerary(itinerary, timeZone);
    const items = days.flatMap((day) => day.segments.flatMap((segment) => segment.items));
    const activity = items.find((item) => item.kind === "activity");
    expect(activity?.kind === "activity" ? activity.posts : []).toEqual([itinerary.posts[0]]);
    expect(items.filter((item) => item.kind === "post")).toEqual([]);
    expect(days[0].expenseSummary).toEqual({ totalAmount: 25.5, expenseCount: 1 });
    expect(days.slice(1).every((day) => day.expenseSummary.expenseCount === 0)).toBe(true);
    expect(JSON.stringify(itinerary)).toBe(before);
  });
  it("keeps distinct destinations even when their intervals coincide", async () => {
    const project = projectTripItinerary, itinerary = fixture();
    itinerary.destinations.push({ ...itinerary.destinations[0], id: itineraryId(30), name: "Carlos Paz", order: 2 });
    itinerary.days.push({ ...itinerary.days[1], id: itineraryId(31), destinationId: itineraryId(30), order: 4, items: [] });
    const segments = project(itinerary, "UTC")[0].segments;
    expect(segments.filter((s) => s.type === "activity").map((s) => s.destinationName)).toEqual(["Córdoba", "Carlos Paz"]);
  });
  it("does not invent an end for null bounds or mutate canonical input", async () => {
    const project = projectTripItinerary, itinerary = fixture();
    itinerary.days[1].endsAt = null; itinerary.days[1].type = "arrival";
    const snapshot = JSON.stringify(itinerary);
    expect(project(itinerary, "UTC")[0].segments[1].endsAt).toBeNull();
    project(itinerary, "Asia/Tokyo"); expect(JSON.stringify(itinerary)).toBe(snapshot);
    expect(project({ ...itinerary, days: [], activities: [], posts: [], transports: [] }, "UTC")).toEqual([]);
  });
});
