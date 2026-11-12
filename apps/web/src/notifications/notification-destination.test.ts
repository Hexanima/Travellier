import { describe, expect, it } from "vitest";
import { itineraryId } from "../trips/itinerary-test-fixture.js";
import type { TripNotification } from "./trip-notification-api.js";
import { destinationOfNotification, notificationDestination } from "./notification-destination.js";

const trip = itineraryId(1), post = itineraryId(10), activity = itineraryId(11);

describe("notification destination (data of a push or of the inbox)", () => {
  it("opens the exact resource of the notice, always inside the Trip of the notice", () => {
    expect(notificationDestination({ type: "post.created", tripId: trip, postId: post })).toBe(`/trips/${trip}/memories/${post}`);
    expect(notificationDestination({ type: "comment.created", tripId: trip, postId: post })).toBe(`/trips/${trip}/memories/${post}`);
    for (const type of ["activity.created", "activity.updated", "activity.participant_unlinked"])
      expect(notificationDestination({ type, tripId: trip, activityId: activity }), type).toBe(`/trips/${trip}/itinerary?activity=${activity}`);
    expect(notificationDestination({ type: "member.joined", tripId: trip })).toBe(`/trips/${trip}/members`);
  });

  it("opens the members of the Trip for a departure, a role change and an ownership transfer", () => {
    for (const type of ["member.left", "member.role_changed", "trip.ownership_transferred"]) {
      expect(notificationDestination({ type, tripId: trip }), type).toBe(`/trips/${trip}/members`);
      expect(notificationDestination({ type, tripId: "xyz" }), type).toBeNull();
      expect(notificationDestination({ type, tripId: trip, payloadTripId: itineraryId(2) }), type).toBeNull();
    }
  });

  it("never opens the Trip of an expulsion", () => {
    expect(notificationDestination({ type: "member.expelled", tripId: trip })).toBeNull();
    expect(notificationDestination({ type: "member.expelled", tripId: trip, postId: post, activityId: activity })).toBeNull();
  });

  it("is null for ids that are not 24 hex, manipulated ids or a missing resource", () => {
    const bad = ["", "xyz", "../evil", `${post}/../..`, `${post}?x=1`, `${post}#a`, post.toUpperCase().replace(/0/g, "O"), `${post}0`, " ", "%2e%2e"];
    for (const value of bad) {
      expect(notificationDestination({ type: "post.created", tripId: trip, postId: value }), value).toBeNull();
      expect(notificationDestination({ type: "activity.updated", tripId: trip, activityId: value }), value).toBeNull();
      expect(notificationDestination({ type: "member.joined", tripId: value }), value).toBeNull();
    }
    expect(notificationDestination({ type: "post.created", tripId: trip })).toBeNull();
    expect(notificationDestination({ type: "activity.created", tripId: trip })).toBeNull();
    expect(notificationDestination({ type: "comment.created", tripId: trip, activityId: activity })).toBeNull();
  });

  it("is null for an unknown type or a payload tripId that differs from the notice", () => {
    expect(notificationDestination({ type: "activity.deleted", tripId: trip, activityId: activity })).toBeNull();
    expect(notificationDestination({ type: "", tripId: trip })).toBeNull();
    expect(notificationDestination({ type: "post.created", tripId: trip, payloadTripId: itineraryId(2), postId: post })).toBeNull();
    expect(notificationDestination({ type: "post.created", tripId: trip, payloadTripId: trip, postId: post })).toBe(`/trips/${trip}/memories/${post}`);
  });
});

describe("destination of an inbox item", () => {
  const item = (type: string, payload: Record<string, unknown>, tripId = trip) => ({ id: itineraryId(900), type, tripId, actorId: null, createdAt: "2026-11-10T10:00:00.000Z", payload }) as unknown as TripNotification;
  it("uses the ids of the payload and the Trip of the item", () => {
    expect(destinationOfNotification(item("post.created", { postId: post, actorId: itineraryId(5), activityId: activity }))).toBe(`/trips/${trip}/memories/${post}`);
    expect(destinationOfNotification(item("comment.created", { commentId: itineraryId(6), postId: post, actorId: itineraryId(5) }))).toBe(`/trips/${trip}/memories/${post}`);
    expect(destinationOfNotification(item("activity.updated", { activityId: activity, actorId: itineraryId(5), changedFields: ["title"] }))).toBe(`/trips/${trip}/itinerary?activity=${activity}`);
    expect(destinationOfNotification(item("member.joined", { memberId: itineraryId(7), userId: itineraryId(8) }))).toBe(`/trips/${trip}/members`);
    expect(destinationOfNotification(item("member.left", { memberId: itineraryId(7), userId: itineraryId(8) }))).toBe(`/trips/${trip}/members`);
    expect(destinationOfNotification(item("member.role_changed", { userId: itineraryId(8), role: "admin" }))).toBe(`/trips/${trip}/members`);
    expect(destinationOfNotification(item("trip.ownership_transferred", { previousOwnerId: itineraryId(8) }))).toBe(`/trips/${trip}/members`);
    expect(destinationOfNotification(item("member.role_changed", { userId: itineraryId(8), role: "admin" }, "bad"))).toBeNull();
    expect(destinationOfNotification(item("member.expelled", { tripId: trip }))).toBeNull();
  });
});
