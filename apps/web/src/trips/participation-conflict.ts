export type ParticipationConflictReason = "overlap" | "same_start";
export type ParticipationConflict = { activityId: string; reason: ParticipationConflictReason; scheduledAt: string; durationMinutes: number | null };
export type ParticipationConfirmation = {
  confirmedConflicts: ParticipationConflict[];
  confirmedActivity: { scheduledAt: string; durationMinutes: number | null };
};

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const objectId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{24}$/.test(value);
const timestamp = (value: unknown): value is string => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const duration = (value: unknown): value is number | null => value === null || (Number.isSafeInteger(value) && (value as number) > 0);
const reasons: readonly unknown[] = ["overlap", "same_start"];

const parseActivity = (value: unknown): ParticipationConfirmation["confirmedActivity"] | undefined =>
  record(value) && timestamp(value.scheduledAt) && duration(value.durationMinutes)
    ? { scheduledAt: value.scheduledAt, durationMinutes: value.durationMinutes } : undefined;

const parseConflict = (value: unknown): ParticipationConflict | undefined =>
  record(value) && objectId(value.activityId) && reasons.includes(value.reason) && timestamp(value.scheduledAt) && duration(value.durationMinutes)
    ? { activityId: value.activityId, reason: value.reason as ParticipationConflictReason,
      scheduledAt: value.scheduledAt, durationMinutes: value.durationMinutes } : undefined;

/** Validates the 409 snapshot strictly; anything unexpected yields undefined so the caller treats it as a generic failure. */
export const parseConfirmation = (details: Readonly<Record<string, unknown>> | undefined): ParticipationConfirmation | undefined => {
  if (!details || !Array.isArray(details.conflicts) || details.conflicts.length === 0) return undefined;
  const confirmedConflicts = details.conflicts.map(parseConflict);
  const confirmedActivity = parseActivity(details.activity);
  if (!confirmedActivity || confirmedConflicts.some((conflict) => conflict === undefined)) return undefined;
  return { confirmedConflicts: confirmedConflicts as ParticipationConflict[], confirmedActivity };
};
