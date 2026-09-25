import {
  toAuthenticatedUserProfile,
  type AuthenticatedUserProfile,
} from "../../entities/user.js";
import { UserNotFoundError } from "../../errors/user-not-found-error.js";
import type { UserRepository } from "../../ports/authentication-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, type AsyncResult } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";

export interface GetAuthenticatedProfilePayload {
  authenticatedUserId: ObjectId;
}

export interface GetAuthenticatedProfileDependencies<
  TError extends TaggedError = TaggedError,
> {
  users: UserRepository<TError>;
}

export type GetAuthenticatedProfileError = TaggedError | UserNotFoundError;

export const getAuthenticatedProfile: UseCase<
  GetAuthenticatedProfileDependencies,
  GetAuthenticatedProfilePayload,
  AuthenticatedUserProfile,
  GetAuthenticatedProfileError
> = {
  execute: async (
    dependencies,
    payload,
  ): AsyncResult<AuthenticatedUserProfile, GetAuthenticatedProfileError> => {
    const user = await dependencies.users.findById(payload.authenticatedUserId);

    if (!user.ok) {
      return user;
    }

    if (user.value === undefined) {
      return err(new UserNotFoundError());
    }

    return { ok: true, value: toAuthenticatedUserProfile(user.value) };
  },
};
