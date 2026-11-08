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

export type CreateActivityParticipationInput = Omit<ActivityParticipation, "status" | "decisionRequired"> &
  { status: unknown; decisionRequired?: unknown };

const markerFields = ["scheduledAt", "durationMinutes"];
const invalidMarker = (message: string) => err(new ValidationError([{ field: "decisionRequired", code: "invalid", message }]));
const parseMarker = (value: unknown): Result<ParticipationDecisionRequired, ValidationError> => {
  const marker = value as Partial<ParticipationDecisionRequired> | null;
  if (typeof marker !== "object" || marker === null || marker.reason !== "schedule_conflict") {
    return invalidMarker("decisionRequired reason must be schedule_conflict.");
  }
  const fields = marker.changedFields;
  if (!Array.isArray(fields) || fields.length === 0 || new Set(fields).size !== fields.length ||
    !fields.every((f) => markerFields.includes(f))) {
    return invalidMarker("decisionRequired changedFields must be unique scheduledAt/durationMinutes values.");
  }
  if (!(marker.changedAt instanceof Date) || !Number.isFinite(marker.changedAt.getTime())) {
    return invalidMarker("decisionRequired changedAt must be a valid UTC instant.");
  }
  return ok({ reason: "schedule_conflict", changedFields: [...fields], changedAt: new Date(marker.changedAt.getTime()) });
};

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
  const base = { id: input.id, tripId: input.tripId, activityId: input.activityId, userId: input.userId,
    status: input.status as ActivityParticipationStatus, updatedAt: new Date(input.updatedAt.getTime()) };
  if (input.decisionRequired == null) return ok(base);
  if (input.status !== "pending") return invalidMarker("decisionRequired is only valid on a pending participation.");
  const marker = parseMarker(input.decisionRequired);
  return marker.ok ? ok({ ...base, decisionRequired: marker.value }) : marker;
};
