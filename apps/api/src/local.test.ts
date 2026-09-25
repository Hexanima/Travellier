import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createObjectId } from "app-domain";

import { createLocalApi } from "./local.js";
import { createAuthenticationTokenAdapter } from "./auth/authentication-token-adapter.js";

describe("local API entrypoint", () => {
  let mongo: MongoMemoryServer;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
  });

  afterAll(async () => {
    await mongo?.stop();
  });

  it("serves authentication endpoints with local MongoDB and JWT configuration", async () => {
    const localApi = await createLocalApi({
      MONGODB_URI: mongo.getUri(),
      MONGODB_DATABASE_NAME: "travellier_local_test",
      JWT_SECRET: "local-jwt-signing-secret",
    });
    await new Promise<void>((resolve) => localApi.app.listen(0, resolve));
    const { port } = localApi.app.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "local@example.test",
          name: "Local",
          password: "secret-pass",
        }),
      });

      expect(response.status).toBe(201);
      const registration = await response.json() as { user: { id: string; email: string; name: string } };
      expect(registration).toMatchObject({
        user: { email: "local@example.test", name: "Local" },
      });

      const tokens = createAuthenticationTokenAdapter({
        jwtSecret: "local-jwt-signing-secret",
        accessTokenLifetimeMs: 900_000,
      });
      const userId = createObjectId(registration.user.id);
      if (!userId.ok) throw new Error("Invalid registered user id");
      const token = await tokens.createEmailVerificationToken(
        userId.value,
        new Date(Date.now() + 60_000),
      );
      if (!token.ok) throw new Error("Unable to create verification test token");

      const verification = await fetch(`http://127.0.0.1:${port}/auth/verify/${token.value}`);
      expect(verification.status).toBe(200);
      expect(verification.headers.get("content-type")).toContain("text/html");
      expect(await verification.text()).toContain(`com.travellier.app://verify/${token.value}`);

      const invalidVerification = await fetch(`http://127.0.0.1:${port}/auth/verify/invalid-token`);
      expect(invalidVerification.status).toBe(400);
      expect(await invalidVerification.text()).not.toContain("invalid-token");

      const privateRequest = await fetch(`http://127.0.0.1:${port}/profile`, {
        headers: { authorization: `Bearer ${token.value}` },
      });
      expect(privateRequest.status).toBe(401);

      const login = await fetch(`http://127.0.0.1:${port}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "local@example.test",
          password: "secret-pass",
        }),
      });
      const session = await login.json() as { accessToken: string };

      const profile = await fetch(`http://127.0.0.1:${port}/profile`, {
        headers: { authorization: `Bearer ${session.accessToken}` },
      });

      expect(profile.status).toBe(200);
      await expect(profile.json()).resolves.toEqual({
        profile: { name: "Local", email: "local@example.test", avatar: null },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        localApi.app.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
      await localApi.close();
    }
  });
});
