import { describe, expect, it, vi } from "vitest";

import * as domain from "../../index.js";

const userId = "507f1f77bcf86cd799439011";

type VerifyEmailToken = {
  execute: (
    dependencies: {
      tokens: { readEmailVerificationTokenSubject: (token: string) => Promise<unknown> };
      users: { findById: (id: string) => Promise<unknown> };
    },
    payload: { token: string },
  ) => Promise<unknown>;
};

const verifyEmailToken = (domain as typeof domain & {
  verifyEmailToken?: VerifyEmailToken;
}).verifyEmailToken;

describe("verify email token", () => {
  it("accepts a verification token for an existing user", async () => {
    const readEmailVerificationTokenSubject = vi.fn().mockResolvedValue({
      ok: true,
      value: userId,
    });
    const findById = vi.fn().mockResolvedValue({
      ok: true,
      value: { id: userId, email: "nico@example.test" },
    });

    const result = await verifyEmailToken?.execute(
      { tokens: { readEmailVerificationTokenSubject }, users: { findById } },
      { token: "signed-token" },
    );

    expect(result).toEqual({ ok: true, value: undefined });
    expect(readEmailVerificationTokenSubject).toHaveBeenCalledWith("signed-token");
    expect(findById).toHaveBeenCalledWith(userId);
  });

  it("rejects an invalid token without querying users", async () => {
    const readEmailVerificationTokenSubject = vi.fn().mockResolvedValue({
      ok: true,
      value: undefined,
    });
    const findById = vi.fn();

    const result = await verifyEmailToken?.execute(
      { tokens: { readEmailVerificationTokenSubject }, users: { findById } },
      { token: "invalid-token" },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { tag: "InvalidEmailVerificationTokenError" },
    });
    expect(findById).not.toHaveBeenCalled();
  });

  it("rejects a validly signed token for a deleted user", async () => {
    const result = await verifyEmailToken?.execute(
      {
        tokens: {
          readEmailVerificationTokenSubject: async () => ({ ok: true, value: userId }),
        },
        users: { findById: async () => ({ ok: true, value: undefined }) },
      },
      { token: "signed-token" },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { tag: "InvalidEmailVerificationTokenError" },
    });
  });
});
