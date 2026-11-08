import { ValidationError } from "../errors/validation-error.js";
import { err, ok, type Result } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";
import type { ItineraryDay } from "./itinerary-day.js";

export interface ActivitySchedule {
  tripId: ObjectId;
  dayId: ObjectId;
  scheduledAt: Date;
  /** Optional positive whole minutes; the end is derived, never stored. */
  durationMinutes?: number | null;
}

const MINUTE_MS = 60_000;

/** Derived end instant (start + duration), or null when the duration is absent. */
export const activityEndsAt = (schedule: Pick<ActivitySchedule, "scheduledAt" | "durationMinutes">): Date | null =>
  schedule.durationMinutes == null ? null : new Date(schedule.scheduledAt.getTime() + schedule.durationMinutes * MINUTE_MS);

const invalid = (field: string, code: string, message: string) =>
  err(new ValidationError([{ field, code, message }]));

/** Validate against canonical itinerary slices, independently of the user's calendar timezone. */
export const validateActivitySchedule = (
  input: ActivitySchedule,
  days: readonly ItineraryDay[],
): Result<void, ValidationError> => {
  if (input.scheduledAt == null) {
    return invalid("scheduledAt", "required", "Activity date and time are required.");
  }
  if (!(input.scheduledAt instanceof Date) || !Number.isFinite(input.scheduledAt.getTime())) {
    return invalid("scheduledAt", "invalid", "Activity date and time must be a valid UTC instant.");
  }
  const day = days.find((value) => value.id === input.dayId);
  if (!day) return invalid("dayId", "not_found", "Activity day must be included in the itinerary.");
  if (day.tripId !== input.tripId) return invalid("dayId", "mismatch", "Activity day must belong to the Trip.");
  if (day.type !== "activity") return invalid("dayId", "invalid", "Activities require an enabled activity slice.");
  if (!(day.startsAt instanceof Date) || !Number.isFinite(day.startsAt.getTime()) ||
      !(day.endsAt instanceof Date) || !Number.isFinite(day.endsAt.getTime()) ||
      day.endsAt.getTime() <= day.startsAt.getTime()) {
    return invalid("dayId", "invalid_window", "Activity slice must have valid, increasing bounds.");
  }
  const start = day.startsAt.getTime(), end = day.endsAt.getTime();
  const timestamp = input.scheduledAt.getTime();
  // Consecutive slices own their start; the final departure instant is inclusive.
  const nextActivity = days.some((next) => next.tripId === input.tripId &&
    next.destinationId === day.destinationId && next.type === "activity" &&
    next.startsAt instanceof Date && next.startsAt.getTime() === end);
  if (timestamp < start || timestamp > end || (timestamp === end && nextActivity)) {
    return invalid("scheduledAt", "outside_window", "Activity date and time must belong to the selected activity slice.");
  }
  const duration = input.durationMinutes;
  if (duration == null) return ok(undefined);
  if (typeof duration !== "number" || !Number.isInteger(duration) || duration <= 0) {
    return invalid("durationMinutes", "invalid", "Activity duration must be a positive whole number of minutes.");
  }
  // The destination window continues through contiguous activity slices of the same Trip and destination.
  let limit = end;
  for (;;) {
    const following = days.find((value) => value.tripId === input.tripId && value.destinationId === day.destinationId &&
      value.type === "activity" && value.startsAt instanceof Date && value.startsAt.getTime() === limit &&
      value.endsAt instanceof Date && value.endsAt.getTime() > limit);
    if (!following) break;
    limit = following.endsAt!.getTime();
  }
  if (timestamp + duration * MINUTE_MS > limit) {
    return invalid("durationMinutes", "outside_window", "Activity end must not exceed the destination departure.");
  }
  return ok(undefined);
};

/**
 * Derives the activity slice that owns an instant, for callers that do not send `dayId`.
 * Only the start is evaluated (duration and window limits are validated afterwards with the resolved slice).
 * A contiguous boundary belongs to the following slice; overlapping slices of different destinations are ambiguous.
 */
export const resolveActivityDayId = (
  days: readonly ItineraryDay[],
  tripId: ObjectId,
  scheduledAt: Date,
): Result<ObjectId, ValidationError> => {
  if (scheduledAt == null) return invalid("scheduledAt", "required", "Activity date and time are required.");
  if (!(scheduledAt instanceof Date) || !Number.isFinite(scheduledAt.getTime())) {
    return invalid("scheduledAt", "invalid", "Activity date and time must be a valid UTC instant.");
  }
  const matches = days.filter((day) => day.tripId === tripId && day.type === "activity" &&
    validateActivitySchedule({ tripId, dayId: day.id, scheduledAt }, days).ok);
  if (matches.length === 0) {
    return invalid("scheduledAt", "outside_window", "Activity date and time must belong to an enabled activity slice.");
  }
  if (matches.length > 1) return invalid("dayId", "ambiguous", "Activity date and time match more than one activity slice.");
  return ok(matches[0]!.id);
};
