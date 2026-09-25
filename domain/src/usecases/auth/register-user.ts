import { toUserProfile, type UserProfile } from "../../entities/user.js";
import { EmailAlreadyRegisteredError } from "../../errors/email-already-registered-error.js";
import { ValidationError } from "../../errors/validation-error.js";
import type { TaggedError } from "../../types/error.js";
import { err, type AsyncResult } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import type { PasswordHasher, UserRepository } from "../../ports/authentication-port.js";

export interface RegisterUserPayload {
  email: string;
  name: string;
  password: string;
}

export interface RegisterUserDependencies<
  TError extends TaggedError = TaggedError,
> {
  users: UserRepository<TError>;
  passwordHasher: PasswordHasher<TError>;
}

export type RegisterUserError =
  | TaggedError
  | ValidationError
  | EmailAlreadyRegisteredError;

const validate = (payload: RegisterUserPayload): ValidationError | undefined => {
  const issues = [];

  if (payload.email.trim() === "" || !payload.email.includes("@")) {
    issues.push({
      field: "email",
      code: "invalid",
      message: "Email must be valid.",
    });
  }

  if (payload.name.trim() === "") {
    issues.push({
      field: "name",
      code: "required",
      message: "Name is required.",
    });
  }

  if (payload.password.trim() === "") {
    issues.push({
      field: "password",
      code: "required",
      message: "Password is required.",
    });
  }

  return issues.length === 0 ? undefined : new ValidationError(issues);
};

export const registerUser: UseCase<
  RegisterUserDependencies,
  RegisterUserPayload,
  UserProfile,
  RegisterUserError
> = {
  execute: async (dependencies, payload): AsyncResult<UserProfile, RegisterUserError> => {
    const validationError = validate(payload);

    if (validationError !== undefined) {
      return err(validationError);
    }

    const existingUser = await dependencies.users.findByEmail(payload.email);

    if (!existingUser.ok) {
      return existingUser;
    }

    if (existingUser.value !== undefined) {
      return err(new EmailAlreadyRegisteredError());
    }

    const passwordHash = await dependencies.passwordHasher.hash(payload.password);

    if (!passwordHash.ok) {
      return passwordHash;
    }

    const user = await dependencies.users.create({
      email: payload.email,
      name: payload.name,
      passwordHash: passwordHash.value,
    });

    if (!user.ok) {
      return user;
    }

    return { ok: true, value: toUserProfile(user.value) };
  },
};
