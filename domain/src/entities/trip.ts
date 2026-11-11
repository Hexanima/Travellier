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
  expenseMode: TripExpenseMode;
  /** Titular actual del viaje; siempre es admin. */
  ownerId: ObjectId;
  /** Creador original; dato histórico que no cambia al transferir la titularidad. */
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

  const trip: Trip = {
    id: input.tripId,
    name: input.name,
    description: input.description ?? null,
    visibility: input.visibility ?? "private",
    inviteCode: input.inviteCode,
    expenseMode: input.expenseMode ?? "register",
    ownerId: input.creatorId,
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
