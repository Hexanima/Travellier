import { ValidationError } from "../errors/validation-error.js";
import { err, ok, type Result } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";
import { validateActivitySchedule, type ActivitySchedule } from "./activity-schedule.js";
import type { ItineraryDay } from "./itinerary-day.js";
import type { Trip } from "./trip.js";

export type ActivityStatus = "proposed" | "voting" | "confirmed";

/** Planned and spontaneous activities share the same mandatory occurrence time. */
export interface Activity extends ActivitySchedule {
  id: ObjectId;
  title: string;
  description: string | null;
  mapsUrl: string | null;
  status: ActivityStatus;
  createdBy: ObjectId;
  createdAt: Date;
}

export type CreateActivityInput = Omit<Activity, "status" | "description" | "mapsUrl"> & {
  description?: string | null;
  mapsUrl?: string | null;
};

export interface CreateActivityContext {
  trip: Pick<Trip, "id" | "votingEnabled">;
  days: readonly ItineraryDay[];
}

const invalid = (field: string, code: string, message: string) =>
  err(new ValidationError([{ field, code, message }]));

/** The caller supplies the current Trip and canonical itinerary from a consistent snapshot. */
export const createActivity = (
  input: CreateActivityInput,
  context: CreateActivityContext,
): Result<Activity, ValidationError> => {
  if (input.tripId !== context.trip.id) {
    return invalid("tripId", "mismatch", "Activity must belong to the supplied Trip.");
  }
  if (typeof context.trip.votingEnabled !== "boolean") {
    return invalid("votingEnabled", "invalid", "Trip voting configuration must be a boolean.");
  }
  if (typeof input.title !== "string" || input.title.trim() === "") {
    return invalid("title", "required", "Activity title is required.");
  }
  for (const field of ["description", "mapsUrl"] as const) {
    if (input[field] != null && typeof input[field] !== "string") {
      return invalid(field, "invalid", `Activity ${field} must be text or null.`);
    }
  }
  if (!(input.createdAt instanceof Date) || !Number.isFinite(input.createdAt.getTime())) {
    return invalid("createdAt", "invalid", "Activity creation time must be a valid UTC instant.");
  }
  const schedule = validateActivitySchedule(input, context.days);
  if (!schedule.ok) return schedule;
  return ok({
    id: input.id,
    tripId: input.tripId,
    dayId: input.dayId,
    title: input.title,
    description: input.description ?? null,
    scheduledAt: new Date(input.scheduledAt.getTime()),
    mapsUrl: input.mapsUrl ?? null,
    status: context.trip.votingEnabled ? "proposed" : "confirmed",
    createdBy: input.createdBy,
    createdAt: new Date(input.createdAt.getTime()),
  });
};
