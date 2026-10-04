import { ValidationError } from "../errors/validation-error.js";
import { err, ok, type Result } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";
import type { ItineraryDay } from "./itinerary-day.js";

export interface ActivitySchedule {
  tripId: ObjectId;
  dayId: ObjectId;
  scheduledAt: Date;
}

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
  return ok(undefined);
};
