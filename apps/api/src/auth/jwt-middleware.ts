import { jwtVerify } from "jose";

import { createObjectId, type ObjectId } from "app-domain";

export interface AuthenticatedRequest {
  authenticatedUserId: ObjectId;
}

export interface JwtMiddlewareDependencies {
  jwtSecret: string;
}

const bearerToken = (authorization: string | undefined): string | undefined => {
  const match = authorization?.match(/^Bearer ([^\s]+)$/);

  return match?.[1];
};

export const createJwtMiddleware = ({
  jwtSecret,
}: JwtMiddlewareDependencies) => {
  const secret = new TextEncoder().encode(jwtSecret);

  return async (
    authorization: string | undefined,
  ): Promise<AuthenticatedRequest | undefined> => {
    const token = bearerToken(authorization);

    if (token === undefined) {
      return undefined;
    }

    try {
      const { payload } = await jwtVerify(token, secret, {
        algorithms: ["HS256"],
      });

      if (typeof payload.sub !== "string" || typeof payload.exp !== "number") {
        return undefined;
      }

      const userId = createObjectId(payload.sub);

      if (!userId.ok) {
        return undefined;
      }

      return { authenticatedUserId: userId.value };
    } catch {
      return undefined;
    }
  };
};
