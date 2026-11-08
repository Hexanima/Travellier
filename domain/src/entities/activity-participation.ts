import { ValidationError } from "../errors/validation-error.js";
import { err, ok, type Result } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

export type ActivityParticipationStatus = "going" | "not_going" | "pending";

/** Persisted personal marker: the user must decide again. Written by the system (schedule edits), cleared only by an explicit going/not_going. */
export interface ParticipationDecisionRequired {
  reason: "schedule_conflict";
  changedFields: ("scheduledAt" | "durationMinutes")[];
  changedAt: Date;
}

export interface ActivityParticipation {
  id: ObjectId;
  tripId: ObjectId;
  activityId: ObjectId;
  userId: ObjectId;
  status: ActivityParticipationStatus;
  updatedAt: Date;
  /** Absent or null when no decision is required. */
  decisionRequired?: ParticipationDecisionRequired | null;
}

export type CreateActivityParticipationInput = Omit<ActivityParticipation, "status"> & { status: unknown };

export const createActivityParticipation = (
  input: CreateActivityParticipationInput,
): Result<ActivityParticipation, ValidationError> => {
  if (input.status !== "going" && input.status !== "not_going" && input.status !== "pending") {
    return err(new ValidationError([{ field: "status", code: input.status == null ? "required" : "invalid",
      message: "Participation status must be going, not_going or pending." }]));
  }
  if (!(input.updatedAt instanceof Date) || !Number.isFinite(input.updatedAt.getTime())) {
    return err(new ValidationError([{ field: "updatedAt", code: "invalid", message: "Participation update time must be a valid UTC instant." }]));
  }
  return ok({ id: input.id, tripId: input.tripId, activityId: input.activityId, userId: input.userId,
    status: input.status, updatedAt: new Date(input.updatedAt.getTime()) });
};
