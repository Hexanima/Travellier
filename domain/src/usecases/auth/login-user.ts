import { InvalidCredentialsError } from "../../errors/invalid-credentials-error.js";
import { ValidationError } from "../../errors/validation-error.js";
import type {
  AuthenticationTokenPort,
  PasswordHasher,
  RefreshSessionRepository,
  UserRepository,
} from "../../ports/authentication-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, type AsyncResult } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";

export interface LoginUserPayload {
  email: string;
  password: string;
}

export interface AuthenticatedSession {
  accessToken: string;
  refreshToken: string;
}

export interface LoginUserDependencies<
  TError extends TaggedError = TaggedError,
> {
  users: UserRepository<TError>;
  passwordHasher: PasswordHasher<TError>;
  sessions: RefreshSessionRepository<TError>;
  tokens: AuthenticationTokenPort<TError>;
  now: () => Date;
  refreshTokenLifetimeMs: number;
}

export type LoginUserError = TaggedError | InvalidCredentialsError;

const validate = (payload: LoginUserPayload): ValidationError | undefined => {
  const issues = [];

  if (payload.email.trim() === "" || !payload.email.includes("@")) {
    issues.push({
      field: "email",
      code: "invalid",
      message: "Email must be valid.",
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

export const loginUser: UseCase<
  LoginUserDependencies,
  LoginUserPayload,
  AuthenticatedSession,
  LoginUserError
> = {
  execute: async (dependencies, payload): AsyncResult<
    AuthenticatedSession,
    LoginUserError
  > => {
    const validationError = validate(payload);

    if (validationError !== undefined) {
      return err(validationError);
    }

    const user = await dependencies.users.findByEmail(payload.email);

    if (!user.ok) {
      return user;
    }

    if (user.value === undefined) {
      return err(new InvalidCredentialsError());
    }

    const passwordMatches = await dependencies.passwordHasher.verify(
      payload.password,
      user.value.passwordHash,
    );

    if (!passwordMatches.ok) {
      return passwordMatches;
    }

    if (!passwordMatches.value) {
      return err(new InvalidCredentialsError());
    }

    const refreshToken = await dependencies.tokens.createRefreshToken();

    if (!refreshToken.ok) {
      return refreshToken;
    }

    const refreshTokenHash = await dependencies.tokens.hashRefreshToken(
      refreshToken.value,
    );

    if (!refreshTokenHash.ok) {
      return refreshTokenHash;
    }

    const session = await dependencies.sessions.create({
      userId: user.value.id,
      tokenHash: refreshTokenHash.value,
      expiresAt: new Date(
        dependencies.now().getTime() + dependencies.refreshTokenLifetimeMs,
      ),
    });

    if (!session.ok) {
      return session;
    }

    const accessToken = await dependencies.tokens.createAccessToken(user.value.id);

    if (!accessToken.ok) {
      return accessToken;
    }

    return {
      ok: true,
      value: {
        accessToken: accessToken.value,
        refreshToken: refreshToken.value,
      },
    };
  },
};
