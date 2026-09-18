import type {
  NewRefreshSession,
  NewUser,
  RefreshSession,
  User,
} from "../entities/index.js";
import type { TaggedError } from "../types/error.js";
import type { AsyncResult } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

export interface UserRepository<TError extends TaggedError = TaggedError> {
  findByEmail: (email: string) => AsyncResult<User | undefined, TError>;
  create: (user: NewUser) => AsyncResult<User, TError>;
}

export interface PasswordHasher<TError extends TaggedError = TaggedError> {
  hash: (password: string) => AsyncResult<string, TError>;
  verify: (password: string, passwordHash: string) => AsyncResult<boolean, TError>;
}

export interface RefreshSessionRepository<
  TError extends TaggedError = TaggedError,
> {
  consume: (
    tokenHash: string,
  ) => AsyncResult<RefreshSession | undefined, TError>;
  create: (session: NewRefreshSession) => AsyncResult<void, TError>;
}

export interface AuthenticationTokenPort<
  TError extends TaggedError = TaggedError,
> {
  createAccessToken: (userId: ObjectId) => AsyncResult<string, TError>;
  createRefreshToken: (expiresAt: Date) => AsyncResult<string, TError>;
  readRefreshTokenExpiration: (
    token: string,
  ) => AsyncResult<Date | undefined, TError>;
  hashRefreshToken: (token: string) => AsyncResult<string, TError>;
}
