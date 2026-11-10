import { describe, expect, it } from "vitest";
import type { TripItineraryResponse } from "./trip-itinerary-api.js";
import { bandOf, itineraryFixture, itineraryId, settleItinerary } from "./itinerary-test-fixture.js";

describe("itinerary test fixture mirrors the backend", () => {
  it("bandOf contains the instant in [startsAt, endsAt) and falls back to the lowest-order day with the same UTC date", () => {
    const days = [
      { id: "b", date: "2026-09-25T00:00:00.000Z", startsAt: "2026-09-25T10:00:00.000Z", endsAt: "2026-09-25T18:00:00.000Z", order: 2 },
      { id: "a", date: "2026-09-25T00:00:00.000Z", startsAt: "2026-09-25T08:00:00.000Z", endsAt: "2026-09-25T10:00:00.000Z", order: 1 },
    ];
    expect(bandOf(days, "2026-09-25T10:00:00.000Z")).toBe("b");
    expect(bandOf(days, "2026-09-25T09:59:59.999Z")).toBe("a");
    // Outside every slice but on the same UTC date: the lowest order wins, not the array order.
    expect(bandOf(days, "2026-09-25T20:00:00.000Z")).toBe("a");
    expect(bandOf(days, "2026-09-26T00:00:00.000Z")).toBeNull();
  });
  it("settleItinerary moves posts without a day to unplacedPosts and rebuilds the day items", () => {
    const value = itineraryFixture() as TripItineraryResponse;
    value.activities[1].dayId = itineraryId(5); value.activities[1].scheduledAt = "2026-09-25T19:00:00.000Z";
    value.activities = value.activities.filter((activity) => activity.id !== itineraryId(8));
    value.posts[0].createdAt = "2026-10-03T12:00:00.000Z";
    settleItinerary(value);
    expect(value.days.map((day) => day.items.map((entry) => entry.id))).toEqual([[itineraryId(6)], [], [itineraryId(7), itineraryId(9)]]);
    expect(value.posts.map((post) => post.id)).toEqual([itineraryId(11)]);
    expect(value.unplacedPosts.map((post) => post.id)).toEqual([itineraryId(10)]);
  });
});
