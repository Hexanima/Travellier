import { ValidationError } from "../errors/validation-error.js";
import { err, ok, type Result } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

export type ActivityVoteValue = "up" | "down";

export interface ActivityVote {
  id: ObjectId;
  tripId: ObjectId;
  activityId: ObjectId;
  userId: ObjectId;
  value: ActivityVoteValue;
  createdAt: Date;
}

export type CreateActivityVoteInput = Omit<ActivityVote, "value"> & { value: unknown };

export const createActivityVote = (input: CreateActivityVoteInput): Result<ActivityVote, ValidationError> => {
  if (input.value !== "up" && input.value !== "down") {
    return err(new ValidationError([{ field: "value", code: input.value == null ? "required" : "invalid",
      message: "Vote value must be up or down." }]));
  }
  if (!(input.createdAt instanceof Date) || !Number.isFinite(input.createdAt.getTime())) {
    return err(new ValidationError([{ field: "createdAt", code: "invalid", message: "Vote creation time must be a valid UTC instant." }]));
  }
  return ok({ id: input.id, tripId: input.tripId, activityId: input.activityId, userId: input.userId,
    value: input.value, createdAt: new Date(input.createdAt.getTime()) });
};
