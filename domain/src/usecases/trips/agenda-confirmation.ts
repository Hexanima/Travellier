import { type ActivityConflict } from "../../entities/activity-conflict.js";
import { ValidationError } from "../../errors/validation-error.js";
import { err, ok } from "../../types/result.js";
import { createObjectId } from "../../value-objects/object-id.js";

export interface ConfirmedConflict { activityId: string; scheduledAt: number; durationMinutes: number | null }

const invalid = (field: string, code: string, message: string) => err(new ValidationError([{ field, code, message }]));

/** Parse the conflict snapshot the user saw when confirming a plan change. */
export const parseConfirmed = (value: unknown) => {
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

export const parseConfirmedActivity = (value: unknown): { scheduledAt: number; durationMinutes: number | null } | undefined | "invalid" => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") return "invalid";
  const { scheduledAt, durationMinutes } = value as Record<string, unknown>;
  const start = scheduledAt instanceof Date ? scheduledAt.getTime()
    : typeof scheduledAt === "number" ? scheduledAt : typeof scheduledAt === "string" ? Date.parse(scheduledAt) : NaN;
  const duration = durationMinutes === undefined ? null : durationMinutes;
  if (!Number.isFinite(start) || (duration !== null && (typeof duration !== "number" || !Number.isFinite(duration)))) return "invalid";
  return { scheduledAt: start, durationMinutes: duration };
};

export const sameSnapshot = (confirmed: ConfirmedConflict[], conflicts: readonly ActivityConflict[]) => {
  const key = (c: ConfirmedConflict) => `${c.activityId}|${c.scheduledAt}|${c.durationMinutes ?? ""}`;
  const expected = conflicts.map((c) => key({ activityId: c.activityId, scheduledAt: c.scheduledAt.getTime(), durationMinutes: c.durationMinutes })).sort();
  const received = confirmed.map(key).sort();
  return expected.length === received.length && expected.every((value, index) => value === received[index]);
};
