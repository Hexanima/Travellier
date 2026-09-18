import type { AuthenticatedSession } from "./login-user.js";
import { InvalidSessionError } from "../../errors/invalid-session-error.js";
import { SessionExpiredError } from "../../errors/session-expired-error.js";
import type {
  AuthenticationTokenPort,
  RefreshSessionRepository,
} from "../../ports/authentication-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, type AsyncResult } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";

export interface RefreshSessionPayload {
  refreshToken: string;
}

export interface RefreshSessionDependencies<
  TError extends TaggedError = TaggedError,
> {
  sessions: RefreshSessionRepository<TError>;
  tokens: AuthenticationTokenPort<TError>;
  now: () => Date;
  refreshTokenLifetimeMs: number;
}

export type RefreshSessionError =
  | TaggedError
  | InvalidSessionError
  | SessionExpiredError;

export const refreshSession: UseCase<
  RefreshSessionDependencies,
  RefreshSessionPayload,
  AuthenticatedSession,
  RefreshSessionError
> = {
  execute: async (dependencies, payload): AsyncResult<
    AuthenticatedSession,
    RefreshSessionError
  > => {
    const tokenExpiration = await dependencies.tokens.readRefreshTokenExpiration(
      payload.refreshToken,
    );

    if (!tokenExpiration.ok) {
      return tokenExpiration;
    }

    if (tokenExpiration.value === undefined) {
      return err(new InvalidSessionError());
    }

    if (tokenExpiration.value.getTime() <= dependencies.now().getTime()) {
      return err(new SessionExpiredError());
    }

    const currentTokenHash = await dependencies.tokens.hashRefreshToken(
      payload.refreshToken,
    );

    if (!currentTokenHash.ok) {
      return currentTokenHash;
    }

    const currentSession = await dependencies.sessions.consume(
      currentTokenHash.value,
    );

    if (!currentSession.ok) {
      return currentSession;
    }

    if (currentSession.value === undefined) {
      return err(new InvalidSessionError());
    }

    if (currentSession.value.expiresAt.getTime() <= dependencies.now().getTime()) {
      return err(new SessionExpiredError());
    }

    const refreshTokenExpiresAt = new Date(
      dependencies.now().getTime() + dependencies.refreshTokenLifetimeMs,
    );
    const refreshToken = await dependencies.tokens.createRefreshToken(
      refreshTokenExpiresAt,
    );

    if (!refreshToken.ok) {
      return refreshToken;
    }

    const refreshTokenHash = await dependencies.tokens.hashRefreshToken(
      refreshToken.value,
    );

    if (!refreshTokenHash.ok) {
      return refreshTokenHash;
    }

    const createdSession = await dependencies.sessions.create({
      userId: currentSession.value.userId,
      tokenHash: refreshTokenHash.value,
      expiresAt: refreshTokenExpiresAt,
    });

    if (!createdSession.ok) {
      return createdSession;
    }

    const accessToken = await dependencies.tokens.createAccessToken(
      currentSession.value.userId,
    );

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
