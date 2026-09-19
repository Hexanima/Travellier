import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";

import { createLocalApi } from "./local.js";

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
      await expect(response.json()).resolves.toMatchObject({
        user: { email: "local@example.test", name: "Local" },
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
