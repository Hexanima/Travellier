import { createHash, randomUUID } from "node:crypto";

import { compactVerify, decodeJwt, jwtVerify, SignJWT } from "jose";

import { createObjectId, err, ok, UnknownError, type AuthenticationTokenPort, type EmailVerificationTokenPort } from "app-domain";

export interface AuthenticationTokenAdapterDependencies {
  jwtSecret: string;
  accessTokenLifetimeMs: number;
  now?: () => Date;
}

const tokenTypeClaim = "tokenType";

const signToken = async (
  secret: Uint8Array,
  type: "access" | "refresh" | "email-verification",
  expiresAt: Date,
  now: Date,
  subject?: string,
): Promise<string> => {
  const token = new SignJWT({ [tokenTypeClaim]: type, jti: randomUUID() })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(Math.floor(now.getTime() / 1_000))
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1_000));

  if (subject !== undefined) {
    token.setSubject(subject);
  }

  return token.sign(secret);
};

export const createAuthenticationTokenAdapter = ({
  jwtSecret,
  accessTokenLifetimeMs,
  now = () => new Date(),
}: AuthenticationTokenAdapterDependencies): AuthenticationTokenPort & EmailVerificationTokenPort => {
  const secret = new TextEncoder().encode(jwtSecret);

  return {
    createAccessToken: async (userId) => {
      try {
        const issuedAt = now();

        return ok(
          await signToken(
            secret,
            "access",
            new Date(issuedAt.getTime() + accessTokenLifetimeMs),
            issuedAt,
            userId,
          ),
        );
      } catch {
        return err(new UnknownError("Unable to create access token."));
      }
    },
    createRefreshToken: async (expiresAt) => {
      try {
        return ok(await signToken(secret, "refresh", expiresAt, now()));
      } catch {
        return err(new UnknownError("Unable to create refresh token."));
      }
    },
    readRefreshTokenExpiration: async (token) => {
      try {
        const verification = await compactVerify(token, secret, {
          algorithms: ["HS256"],
        });
        const payload = decodeJwt(token);

        if (
          verification.protectedHeader.alg !== "HS256" ||
          payload[tokenTypeClaim] !== "refresh" ||
          typeof payload.exp !== "number"
        ) {
          return ok(undefined);
        }

        return ok(new Date(payload.exp * 1_000));
      } catch {
        return ok(undefined);
      }
    },
    hashRefreshToken: async (token) =>
      ok(createHash("sha256").update(token).digest("hex")),
    createEmailVerificationToken: async (userId, expiresAt) => {
      try {
        return ok(await signToken(secret, "email-verification", expiresAt, now(), userId));
      } catch {
        return err(new UnknownError("Unable to create email verification token."));
      }
    },
    readEmailVerificationTokenSubject: async (token) => {
      if (token.length > 4_096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
        return ok(undefined);
      }

      try {
        const { payload } = await jwtVerify(token, secret, {
          algorithms: ["HS256"],
          currentDate: now(),
        });
        if (payload[tokenTypeClaim] !== "email-verification" || typeof payload.sub !== "string" || typeof payload.exp !== "number") {
          return ok(undefined);
        }

        const userId = createObjectId(payload.sub);
        return ok(userId.ok ? userId.value : undefined);
      } catch {
        return ok(undefined);
      }
    },
  };
};
