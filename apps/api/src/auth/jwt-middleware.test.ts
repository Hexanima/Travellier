import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createJwtMiddleware } from "./jwt-middleware.js";

const jwtSecret = "jwt-signing-secret";
const userId = "507f1f77bcf86cd799439011";

const encode = (value: object): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const createToken = (payload: object, algorithm = "HS256"): string => {
  const header = encode({ alg: algorithm, typ: "JWT" });
  const encodedPayload = encode({ tokenType: "access", ...payload });
  const signature = createHmac("sha256", jwtSecret)
    .update(`${header}.${encodedPayload}`)
    .digest("base64url");

  return `${header}.${encodedPayload}.${signature}`;
};

describe("JWT middleware", () => {
  it("exposes the ObjectId from a valid Bearer token", async () => {
    const authenticate = createJwtMiddleware({ jwtSecret });

    const result = await authenticate(
      `Bearer ${createToken({ sub: userId, exp: 1_900_000_000 })}`,
    );

    expect(result).toEqual({ authenticatedUserId: userId });
  });

  it.each([
    undefined,
    "Basic access-token",
    "Bearer malformed-token",
    `Bearer ${createToken({ sub: userId, exp: 1 })}`,
    `Bearer ${createToken({ exp: 1_900_000_000 })}`,
    `Bearer ${createToken({ sub: "not-an-object-id", exp: 1_900_000_000 })}`,
    `Bearer ${createToken({ sub: userId, exp: 1_900_000_000 }, "none")}`,
    `Bearer ${createToken({ sub: userId, exp: 1_900_000_000, tokenType: undefined })}`,
  ])("rejects an absent, malformed, invalid, expired or unsafe token", async (header) => {
    const authenticate = createJwtMiddleware({ jwtSecret });

    await expect(authenticate(header)).resolves.toBeUndefined();
  });

  it("rejects a token signed with another secret", async () => {
    const header = encode({ alg: "HS256", typ: "JWT" });
    const payload = encode({ sub: userId, exp: 1_900_000_000, tokenType: "access" });
    const signature = createHmac("sha256", "another-secret")
      .update(`${header}.${payload}`)
      .digest("base64url");
    const authenticate = createJwtMiddleware({ jwtSecret });

    await expect(authenticate(`Bearer ${header}.${payload}.${signature}`)).resolves.toBeUndefined();
  });

  it("does not authenticate a purpose-bound email verification token", async () => {
    const authenticate = createJwtMiddleware({ jwtSecret });
    const verificationToken = createToken({
      sub: userId,
      exp: 1_900_000_000,
      tokenType: "email-verification",
    });

    await expect(authenticate(`Bearer ${verificationToken}`)).resolves.toBeUndefined();
  });
});
