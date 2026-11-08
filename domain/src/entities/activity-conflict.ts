import type { ObjectId } from "../value-objects/object-id.js";
import { activityEndsAt } from "./activity-schedule.js";
import type { ActivityParticipation } from "./activity-participation.js";

/** `same_start` is shown to the user as «Mismo horario». */
export type ActivityConflictReason = "overlap" | "same_start";

export interface ScheduledActivity {
  id: ObjectId;
  tripId: ObjectId;
  scheduledAt: Date;
  durationMinutes?: number | null;
}

export interface ActivityConflict {
  activityId: ObjectId;
  reason: ActivityConflictReason;
  scheduledAt: Date;
  durationMinutes: number | null;
}

/**
 * Pure pairwise rule. With both ends known: overlap when the intervals intersect (contiguous is compatible).
 * Otherwise no interval is invented and only an identical start (ms) conflicts.
 */
export const activitiesConflict = (a: ScheduledActivity, b: ScheduledActivity): ActivityConflictReason | null => {
  const startA = a.scheduledAt.getTime(), startB = b.scheduledAt.getTime();
  const endA = activityEndsAt(a), endB = activityEndsAt(b);
  if (endA && endB) return startA < endB.getTime() && startB < endA.getTime() ? "overlap" : null;
  return startA === startB ? "same_start" : null;
};

export interface FindAgendaConflictsInput {
  candidate: ScheduledActivity;
  userId: ObjectId;
  tripId: ObjectId;
  activities: readonly ScheduledActivity[];
  participations: readonly ActivityParticipation[];
}

/** Conflicts of the candidate against the user's `going` activities of the same Trip, ordered by start then id. */
export const findAgendaConflicts = (input: FindAgendaConflictsInput): ActivityConflict[] => {
  const { candidate, userId, tripId, activities, participations } = input;
  const going = new Set(participations
    .filter((p) => p.status === "going" && p.userId === userId && p.tripId === tripId)
    .map((p) => p.activityId));
  const seen = new Set<ObjectId>();
  const conflicts: ActivityConflict[] = [];
  for (const activity of activities) {
    if (activity.id === candidate.id || activity.tripId !== tripId || !going.has(activity.id) || seen.has(activity.id)) continue;
    seen.add(activity.id);
    const reason = activitiesConflict(candidate, activity);
    if (reason) conflicts.push({ activityId: activity.id, reason, scheduledAt: activity.scheduledAt,
      durationMinutes: activity.durationMinutes ?? null });
  }
  return conflicts.sort((x, y) => x.scheduledAt.getTime() - y.scheduledAt.getTime() ||
    (x.activityId < y.activityId ? -1 : x.activityId > y.activityId ? 1 : 0));
};
