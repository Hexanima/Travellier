import { ValidationError } from "../errors/validation-error.js";
import { err, ok, type Result } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";
import type { TripMember } from "./trip-member.js";

export type TripVisibility = "private" | "public";
export type TripExpenseMode = "register" | "balance";

export interface Trip {
  id: ObjectId;
  name: string;
  description: string | null;
  visibility: TripVisibility;
  inviteCode: string;
  votingEnabled: boolean;
  expenseMode: TripExpenseMode;
  createdBy: ObjectId;
  createdAt: Date;
}

export interface CreateTripWithAdminInput {
  tripId: ObjectId;
  creatorMembershipId: ObjectId;
  creatorId: ObjectId;
  name: string;
  description?: string | null;
  inviteCode: string;
  createdAt: Date;
  visibility?: TripVisibility;
  votingEnabled?: boolean;
  expenseMode?: TripExpenseMode;
}

export interface TripWithAdmin {
  trip: Trip;
  creatorMembership: TripMember;
}

export const createTripWithAdmin = (
  input: CreateTripWithAdminInput,
): Result<TripWithAdmin, ValidationError> => {
  if (input.name.trim() === "") {
    return err(new ValidationError([
      { field: "name", code: "required", message: "Trip name is required." },
    ]));
  }
  if (input.inviteCode.trim() === "") {
    return err(new ValidationError([
      { field: "inviteCode", code: "required", message: "Invitation code is required." },
    ]));
  }
  if (input.visibility !== undefined && input.visibility !== "private" && input.visibility !== "public") {
    return err(new ValidationError([
      { field: "visibility", code: "invalid", message: "Trip visibility is invalid." },
    ]));
  }
  if (input.expenseMode !== undefined && input.expenseMode !== "register" && input.expenseMode !== "balance") {
    return err(new ValidationError([
      { field: "expenseMode", code: "invalid", message: "Trip expense mode is invalid." },
    ]));
  }
  if (input.votingEnabled !== undefined && typeof input.votingEnabled !== "boolean") {
    return err(new ValidationError([
      { field: "votingEnabled", code: "invalid", message: "Trip voting mode is invalid." },
    ]));
  }

  const trip: Trip = {
    id: input.tripId,
    name: input.name,
    description: input.description ?? null,
    visibility: input.visibility ?? "private",
    inviteCode: input.inviteCode,
    votingEnabled: input.votingEnabled ?? false,
    expenseMode: input.expenseMode ?? "register",
    createdBy: input.creatorId,
    createdAt: input.createdAt,
  };

  const creatorMembership: TripMember = {
    id: input.creatorMembershipId,
    tripId: input.tripId,
    userId: input.creatorId,
    role: "admin",
    joinedAt: input.createdAt,
  };

  return ok({ trip, creatorMembership });
};
