import { InvalidEmailVerificationTokenError } from "../../errors/invalid-email-verification-token-error.js";
import type { EmailVerificationTokenPort, UserRepository } from "../../ports/authentication-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, ok } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";

export interface VerifyEmailTokenDependencies<TError extends TaggedError = TaggedError> {
  tokens: Pick<EmailVerificationTokenPort<TError>, "readEmailVerificationTokenSubject">;
  users: Pick<UserRepository<TError>, "findById">;
}

export interface VerifyEmailTokenPayload {
  token: string;
}

export const verifyEmailToken: UseCase<
  VerifyEmailTokenDependencies,
  VerifyEmailTokenPayload,
  void,
  TaggedError | InvalidEmailVerificationTokenError
> = {
  execute: async ({ tokens, users }, { token }) => {
    if (token.trim() === "") {
      return err(new InvalidEmailVerificationTokenError());
    }

    const subject = await tokens.readEmailVerificationTokenSubject(token);
    if (!subject.ok) {
      return subject;
    }
    if (subject.value === undefined) {
      return err(new InvalidEmailVerificationTokenError());
    }

    const user = await users.findById(subject.value);
    if (!user.ok) {
      return user;
    }
    return user.value === undefined
      ? err(new InvalidEmailVerificationTokenError())
      : ok(undefined);
  },
};
