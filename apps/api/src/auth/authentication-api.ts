import type { Db } from "mongodb";

import {
  loginUser,
  getAuthenticatedProfile,
  refreshSession,
  registerUser,
  revokeSession,
  updateAuthenticatedProfile,
} from "app-domain";

import type { AuthenticationApi } from "../app.js";
import { createMongoAuthenticationRepositories } from "../adapters/mongodb/authentication-repositories.js";
import { createAuthenticationTokenAdapter } from "./authentication-token-adapter.js";
import { createBcryptPasswordHasher } from "./bcrypt-password-hasher.js";

const accessTokenLifetimeMs = 15 * 60 * 1_000;
const refreshTokenLifetimeMs = 30 * 24 * 60 * 60 * 1_000;
const bcryptSaltRounds = 12;

export interface AuthenticationApiDependencies {
  database: Db;
  jwtSecret: string;
}

export const createAuthenticationApi = ({
  database,
  jwtSecret,
}: AuthenticationApiDependencies): AuthenticationApi => {
  const { users, sessions } = createMongoAuthenticationRepositories(database);
  const passwordHasher = createBcryptPasswordHasher({
    saltRounds: bcryptSaltRounds,
  });
  const tokens = createAuthenticationTokenAdapter({
    jwtSecret,
    accessTokenLifetimeMs,
  });
  const now = () => new Date();

  return {
    register: (payload) =>
      registerUser.execute({ users, passwordHasher }, payload),
    login: (payload) =>
      loginUser.execute(
        {
          users,
          passwordHasher,
          sessions,
          tokens,
          now,
          refreshTokenLifetimeMs,
        },
        payload,
      ),
    refresh: (payload) =>
      refreshSession.execute(
        { sessions, tokens, now, refreshTokenLifetimeMs },
        payload,
      ),
    logout: (payload) => revokeSession.execute({ sessions, tokens }, payload),
    getProfile: (payload) => getAuthenticatedProfile.execute({ users }, payload),
    updateProfile: (payload) => updateAuthenticatedProfile.execute({ users }, payload),
  };
};
