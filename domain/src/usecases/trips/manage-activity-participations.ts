import { createActivityParticipation, type ActivityParticipation } from "../../entities/activity-participation.js";
import { findAgendaConflicts, type ActivityConflict } from "../../entities/activity-conflict.js";
import { ActivityNotFoundError } from "../../errors/activity-not-found-error.js";
import { TripNotFoundError } from "../../errors/trip-not-found-error.js";
import { ValidationError } from "../../errors/validation-error.js";
import type { TripParticipationPort, TripParticipationReadScope } from "../../ports/trip-participation-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, ok, type AsyncResult } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import { createObjectId, type ObjectId } from "../../value-objects/object-id.js";
import type { ActivityDetailPayload } from "./manage-activities.js";

export type SetTripActivityParticipationPayload = ActivityDetailPayload & { status: unknown; confirmedConflicts?: unknown;
  /** Chosen activity schedule the user saw when confirming. */ confirmedActivity?: unknown };

/** Outcome of a manual response: either saved or an explicit conflict decision is needed (no writes). */
export type SetTripActivityParticipationResult =
  | { outcome: "saved"; participation: ActivityParticipation }
  | { outcome: "confirmation_required"; conflicts: ActivityConflict[]; activity: { scheduledAt: Date; durationMinutes: number | null } };

interface ConfirmedConflict { activityId: string; scheduledAt: number; durationMinutes: number | null }
interface Dependencies { participations: TripParticipationPort }
interface WriteDependencies extends Dependencies { createId: () => ObjectId; now: () => Date }

const authorize = async (scope: TripParticipationReadScope, payload: ActivityDetailPayload) => {
  const member = await scope.findMemberRole(payload.authenticatedUserId);
  if (!member.ok) return member;
  if (member.value !== "admin" && member.value !== "participant") return err(new TripNotFoundError());
  const trip = await scope.findTrip();
  if (!trip.ok) return trip;
  if (trip.value?.id !== payload.tripId) return err(new TripNotFoundError());
  const activity = await scope.findActivity(payload.activityId);
  if (!activity.ok) return activity;
  return activity.value?.id === payload.activityId && activity.value.tripId === payload.tripId
    ? ok(undefined) : err(new ActivityNotFoundError());
};

export const getTripActivityParticipation: UseCase<Dependencies, ActivityDetailPayload, ActivityParticipation | null, TaggedError> = {
  execute: ({ participations }, payload) => participations.withReadSnapshot(payload.tripId, async (scope) => {
    const access = await authorize(scope, payload);
    if (!access.ok) return access;
    const current = await scope.findParticipation(payload.activityId, payload.authenticatedUserId);
    return current.ok ? ok(current.value ?? null) : current;
  }),
};

const invalid = (field: string, code: string, message: string) => err(new ValidationError([{ field, code, message }]));

const parseConfirmed = (value: unknown) => {
  if (value === undefined || value === null) return ok(undefined);
  const bad = () => invalid("confirmedConflicts", "invalid", "Confirmed conflicts must be a list of activityId, scheduledAt and durationMinutes.");
  if (!Array.isArray(value)) return bad();
  const parsed: ConfirmedConflict[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== "object" || item === null) return bad();
    const { activityId, scheduledAt, durationMinutes } = item as Record<string, unknown>;
    const start = scheduledAt instanceof Date ? scheduledAt.getTime()
      : typeof scheduledAt === "number" ? scheduledAt : typeof scheduledAt === "string" ? Date.parse(scheduledAt) : NaN;
    const duration = durationMinutes === undefined ? null : durationMinutes;
    if (typeof activityId !== "string" || !createObjectId(activityId).ok || !Number.isFinite(start) ||
      (duration !== null && (typeof duration !== "number" || !Number.isFinite(duration)))) return bad();
    parsed.push({ activityId, scheduledAt: start, durationMinutes: duration });
  }
  return ok(parsed);
};

const parseConfirmedActivity = (value: unknown): { scheduledAt: number; durationMinutes: number | null } | undefined | "invalid" => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") return "invalid";
  const { scheduledAt, durationMinutes } = value as Record<string, unknown>;
  const start = scheduledAt instanceof Date ? scheduledAt.getTime()
    : typeof scheduledAt === "number" ? scheduledAt : typeof scheduledAt === "string" ? Date.parse(scheduledAt) : NaN;
  const duration = durationMinutes === undefined ? null : durationMinutes;
  if (!Number.isFinite(start) || (duration !== null && (typeof duration !== "number" || !Number.isFinite(duration)))) return "invalid";
  return { scheduledAt: start, durationMinutes: duration };
};

const sameSnapshot = (confirmed: ConfirmedConflict[], conflicts: readonly ActivityConflict[]) => {
  const key = (c: ConfirmedConflict) => `${c.activityId}|${c.scheduledAt}|${c.durationMinutes ?? ""}`;
  const expected = conflicts.map((c) => key({ activityId: c.activityId, scheduledAt: c.scheduledAt.getTime(), durationMinutes: c.durationMinutes })).sort();
  const received = confirmed.map(key).sort();
  return expected.length === received.length && expected.every((value, index) => value === received[index]);
};

export const setTripActivityParticipation: UseCase<WriteDependencies, SetTripActivityParticipationPayload, SetTripActivityParticipationResult, TaggedError> = {
  execute: ({ participations, createId, now }, payload) => participations.withTransaction(payload.tripId, async (scope) => {
    const access = await authorize(scope, payload);
    if (!access.ok) return access;
    // Pending is system-generated only: manual responses are going or not_going.
    const status = payload.status;
    if (status !== "going" && status !== "not_going") {
      return invalid("status", status == null ? "required" : "invalid", "Participation status must be going or not_going.");
    }
    const confirmed = parseConfirmed(payload.confirmedConflicts);
    if (!confirmed.ok) return confirmed;
    const confirmedActivity = parseConfirmedActivity(payload.confirmedActivity);
    if (confirmedActivity === "invalid") return invalid("confirmedActivity", "invalid", "Confirmed activity must include scheduledAt and durationMinutes.");
    const userId = payload.authenticatedUserId, updatedAt = now();
    const current = await scope.findParticipation(payload.activityId, userId);
    if (!current.ok) return current;
    const own = createActivityParticipation({ id: current.value?.id ?? createId(), tripId: payload.tripId,
      activityId: payload.activityId, userId, status, updatedAt });
    if (!own.ok) return own;
    const saveOwn = async (): AsyncResult<SetTripActivityParticipationResult> => {
      const saved = await scope.save(own.value);
      return saved.ok ? ok({ outcome: "saved" as const, participation: saved.value }) : saved;
    };
    if (status === "not_going") return saveOwn();

    const chosen = await scope.findActivity(payload.activityId);
    if (!chosen.ok) return chosen;
    if (!chosen.value) return err(new ActivityNotFoundError());
    const activities = await scope.listActivities();
    if (!activities.ok) return activities;
    const records = await scope.listUserParticipations(userId);
    if (!records.ok) return records;
    const conflicts = findAgendaConflicts({ candidate: chosen.value, userId, tripId: payload.tripId,
      activities: activities.value, participations: records.value });
    if (conflicts.length === 0) return saveOwn();
    // The confirmation must match the conflict set and the chosen schedule as they are right now.
    const chosenSchedule = { scheduledAt: chosen.value.scheduledAt.getTime(), durationMinutes: chosen.value.durationMinutes ?? null };
    if (confirmed.value === undefined || confirmedActivity === undefined || !sameSnapshot(confirmed.value, conflicts) ||
      confirmedActivity.scheduledAt !== chosenSchedule.scheduledAt || confirmedActivity.durationMinutes !== chosenSchedule.durationMinutes) {
      return ok({ outcome: "confirmation_required" as const, conflicts,
        activity: { scheduledAt: chosen.value.scheduledAt, durationMinutes: chosen.value.durationMinutes ?? null } });
    }
    for (const conflict of conflicts) {
      const previous = records.value.find((r) => r.activityId === conflict.activityId);
      const declined = createActivityParticipation({ id: previous?.id ?? createId(), tripId: payload.tripId,
        activityId: conflict.activityId, userId, status: "not_going", updatedAt });
      if (!declined.ok) return declined;
      const result = await scope.save(declined.value);
      if (!result.ok) return result;
    }
    return saveOwn();
  }),
};
