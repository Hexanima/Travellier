import { ValidationError } from "../errors/validation-error.js";
import { err, ok, type Result } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

export interface TripDestination {
  id: ObjectId;
  tripId: ObjectId;
  name: string;
  order: number;
  createdAt: Date;
}

export const createTripDestination = (
  input: TripDestination,
): Result<TripDestination, ValidationError> => {
  if (input.name.trim() === "") {
    return err(new ValidationError([
      { field: "name", code: "required", message: "Destination name is required." },
    ]));
  }
  if (!Number.isSafeInteger(input.order) || input.order < 1) {
    return err(new ValidationError([
      { field: "order", code: "invalid", message: "Destination order must be a positive integer." },
    ]));
  }
  return ok({ ...input });
};
