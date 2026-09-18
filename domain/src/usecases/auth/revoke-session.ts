import { InvalidSessionError } from "../../errors/invalid-session-error.js";
import type {
  AuthenticationTokenPort,
  RefreshSessionRepository,
} from "../../ports/authentication-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, ok, type AsyncResult } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";

export interface RevokeSessionPayload {
  refreshToken: string;
}

export interface RevokeSessionDependencies<
  TError extends TaggedError = TaggedError,
> {
  sessions: Pick<RefreshSessionRepository<TError>, "consume">;
  tokens: Pick<AuthenticationTokenPort<TError>, "hashRefreshToken">;
}

export type RevokeSessionError = TaggedError | InvalidSessionError;

export const revokeSession: UseCase<
  RevokeSessionDependencies,
  RevokeSessionPayload,
  void,
  RevokeSessionError
> = {
  execute: async (dependencies, payload): AsyncResult<void, RevokeSessionError> => {
    const tokenHash = await dependencies.tokens.hashRefreshToken(payload.refreshToken);

    if (!tokenHash.ok) {
      return tokenHash;
    }

    const session = await dependencies.sessions.consume(tokenHash.value);

    if (!session.ok) {
      return session;
    }

    if (session.value === undefined) {
      return err(new InvalidSessionError());
    }

    return ok(undefined);
  },
};
