import bcrypt from "bcrypt";

import { err, ok, UnknownError, type PasswordHasher } from "app-domain";

export interface BcryptPasswordHasherDependencies {
  saltRounds: number;
}

export const createBcryptPasswordHasher = ({
  saltRounds,
}: BcryptPasswordHasherDependencies): PasswordHasher => ({
  hash: async (password) => {
    try {
      return ok(await bcrypt.hash(password, saltRounds));
    } catch {
      return err(new UnknownError("Unable to hash password."));
    }
  },
  verify: async (password, passwordHash) => {
    try {
      return ok(await bcrypt.compare(password, passwordHash));
    } catch {
      return err(new UnknownError("Unable to verify password."));
    }
  },
});
