import {
  toAuthenticatedUserProfile,
  type AuthenticatedUserProfile,
} from "../../entities/user.js";
import { UserNotFoundError } from "../../errors/user-not-found-error.js";
import { ValidationError } from "../../errors/validation-error.js";
import type { UserRepository } from "../../ports/authentication-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, type AsyncResult } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";

export interface UpdateAuthenticatedProfilePayload {
  authenticatedUserId: ObjectId;
  name?: string;
  avatar?: string | null;
}

export interface UpdateAuthenticatedProfileDependencies<
  TError extends TaggedError = TaggedError,
> {
  users: UserRepository<TError>;
}

export type UpdateAuthenticatedProfileError = TaggedError | UserNotFoundError;

const validate = (
  payload: UpdateAuthenticatedProfilePayload,
): ValidationError | undefined => {
  const issues = [];

  if (payload.name !== undefined && payload.name.trim() === "") {
    issues.push({
      field: "name",
      code: "required",
      message: "Name is required.",
    });
  }

  if (payload.name === undefined && payload.avatar === undefined) {
    issues.push({
      field: "profile",
      code: "required",
      message: "At least one profile field is required.",
    });
  }

  if (payload.avatar !== undefined && payload.avatar !== null &&
    !payload.avatar.startsWith(`avatars/${payload.authenticatedUserId}/`)) {
    issues.push({
      field: "avatar", code: "invalid", message: "Avatar does not belong to this user.",
    });
  }

  return issues.length === 0 ? undefined : new ValidationError(issues);
};

export const updateAuthenticatedProfile: UseCase<
  UpdateAuthenticatedProfileDependencies,
  UpdateAuthenticatedProfilePayload,
  AuthenticatedUserProfile,
  UpdateAuthenticatedProfileError
> = {
  execute: async (
    dependencies,
    payload,
  ): AsyncResult<AuthenticatedUserProfile, UpdateAuthenticatedProfileError> => {
    const validationError = validate(payload);

    if (validationError !== undefined) {
      return err(validationError);
    }

    const user = await dependencies.users.updateProfile(payload.authenticatedUserId, {
      ...(payload.name === undefined ? {} : { name: payload.name }),
      ...(payload.avatar === undefined ? {} : { avatarS3Key: payload.avatar }),
    });

    if (!user.ok) {
      return user;
    }

    if (user.value === undefined) {
      return err(new UserNotFoundError());
    }

    return { ok: true, value: toAuthenticatedUserProfile(user.value) };
  },
};
