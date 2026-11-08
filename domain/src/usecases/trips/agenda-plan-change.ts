import { findAgendaConflicts, type ActivityConflict } from "../../entities/activity-conflict.js";
import { createActivityParticipation, type ActivityParticipation } from "../../entities/activity-participation.js";
import type { Activity } from "../../entities/activity.js";
import { ValidationError } from "../../errors/validation-error.js";
import { err, ok, type AsyncResult, type Result } from "../../types/result.js";
import type { ObjectId } from "../../value-objects/object-id.js";
import { parseConfirmed, parseConfirmedActivity, sameSnapshot } from "./agenda-confirmation.js";

export interface EvaluatePlanChangeInput {
  candidate: Activity; userId: ObjectId; tripId: ObjectId;
  activities: readonly Activity[]; participations: readonly ActivityParticipation[];
  /** Conflicts the author saw when confirming the plan change. */ confirmedConflicts?: unknown;
  /** Schedule of the new activity the author saw when confirming. */ confirmedActivity?: unknown;
}
export type PlanChangeEvaluation =
  | { status: "confirmation_required"; conflicts: ActivityConflict[]; activity: { scheduledAt: Date; durationMinutes: number | null } }
  | { status: "ready"; conflicts: ActivityConflict[]; records: readonly ActivityParticipation[] };
export interface ParticipationSaver { saveParticipation: (participation: ActivityParticipation) => AsyncResult<ActivityParticipation> }

/**
 * Shared by every flow that creates an activity and marks the author as going: detects the author's agenda conflicts and
 * requires a confirmation that matches the conflict set and the schedule as they are right now. Pure: writes nothing.
 */
export const evaluatePlanChange = (input: EvaluatePlanChangeInput): Result<PlanChangeEvaluation, ValidationError> => {
  const confirmed = parseConfirmed(input.confirmedConflicts);
  if (!confirmed.ok) return confirmed;
  const confirmedActivity = parseConfirmedActivity(input.confirmedActivity);
  if (confirmedActivity === "invalid") {
    return err(new ValidationError([{ field: "confirmedActivity", code: "invalid", message: "Confirmed activity must include scheduledAt and durationMinutes." }]));
  }
  const { candidate, userId, tripId } = input;
  const conflicts = findAgendaConflicts({ candidate, userId, tripId, activities: input.activities, participations: input.participations });
  if (conflicts.length > 0) {
    const schedule = { scheduledAt: candidate.scheduledAt.getTime(), durationMinutes: candidate.durationMinutes ?? null };
    if (confirmed.value === undefined || confirmedActivity === undefined || !sameSnapshot(confirmed.value, conflicts) ||
      confirmedActivity.scheduledAt !== schedule.scheduledAt || confirmedActivity.durationMinutes !== schedule.durationMinutes) {
      return ok({ status: "confirmation_required", conflicts,
        activity: { scheduledAt: candidate.scheduledAt, durationMinutes: candidate.durationMinutes ?? null } });
    }
  }
  return ok({ status: "ready", conflicts, records: input.participations });
};

/** Saves not_going on every incompatible plan and going on the new activity; returns the author's going. */
export const applyAuthorPlan = async (scope: ParticipationSaver, input: { activity: Activity; userId: ObjectId; tripId: ObjectId;
  conflicts: readonly ActivityConflict[]; records: readonly ActivityParticipation[]; createId: () => ObjectId; updatedAt: Date }):
  AsyncResult<ActivityParticipation> => {
  const { userId, tripId, updatedAt } = input;
  for (const conflict of input.conflicts) {
    const previous = input.records.find((r) => r.activityId === conflict.activityId);
    const declined = createActivityParticipation({ id: previous?.id ?? input.createId(), tripId,
      activityId: conflict.activityId, userId, status: "not_going", updatedAt });
    if (!declined.ok) return declined;
    const saved = await scope.saveParticipation(declined.value);
    if (!saved.ok) return saved;
  }
  const own = createActivityParticipation({ id: input.createId(), tripId, activityId: input.activity.id,
    userId, status: "going", updatedAt });
  return own.ok ? scope.saveParticipation(own.value) : own;
};
