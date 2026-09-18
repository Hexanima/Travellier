import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createLambdaHandler } from "./lambda.js";

const jwtSecret = "jwt-signing-secret";
const authenticatedUserId = "507f1f77bcf86cd799439011";

const createAccessToken = (userId: string): string => {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ sub: userId, exp: 1_900_000_000 }),
  ).toString("base64url");
  const signature = createHmac("sha256", jwtSecret)
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
};

describe("Lambda API handler", () => {
  it("returns the health response without requiring runtime secrets", async () => {
    let runtimeConfigurationLoads = 0;
    const handler = createLambdaHandler({
      loadRuntimeConfig: async () => {
        runtimeConfigurationLoads += 1;
        throw new Error("runtime configuration is not available");
      },
    });

    const response = await handler({
      version: "2.0",
      routeKey: "GET /health",
      rawPath: "/health",
      rawQueryString: "",
      headers: {},
      requestContext: {
        accountId: "test-account",
        apiId: "test-api",
        domainName: "test.execute-api.us-east-1.amazonaws.com",
        domainPrefix: "test",
        http: {
          method: "GET",
          path: "/health",
          protocol: "HTTP/1.1",
          sourceIp: "127.0.0.1",
          userAgent: "vitest",
        },
        requestId: "test-request",
        routeKey: "GET /health",
        stage: "dev",
        time: "14/Sep/2026:00:00:00 +0000",
        timeEpoch: 1_789_344_000_000,
      },
      isBase64Encoded: false,
    });

    expect(response).toMatchObject({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app: "travellier", status: "ready" }),
    });
    expect(runtimeConfigurationLoads).toBe(0);
  });

  it("loads runtime configuration before processing a non-health route", async () => {
    let runtimeConfigurationLoads = 0;
    const handler = createLambdaHandler({
      loadRuntimeConfig: async () => {
        runtimeConfigurationLoads += 1;

        return {
          environment: "dev",
          mongo: {
            uri: "mongodb+srv://travellier.example/database",
            databaseName: "travellier_dev",
          },
          jwtSecret,
          photoBucketName: "travellier-dev-photos",
        };
      },
    });

    const response = await handler({
      rawPath: "/trips",
      requestContext: { http: { method: "GET" } },
    });

    expect(response).toMatchObject({
      statusCode: 401,
      body: JSON.stringify({ error: "Unauthorized" }),
    });
    expect(runtimeConfigurationLoads).toBe(1);
  });

  it.each([undefined, "Basic access-token", "Bearer invalid-token"])(
    "returns 401 when a private route has no valid JWT (%s)",
    async (authorization) => {
      const handler = createLambdaHandler({
        loadRuntimeConfig: async () => ({
          environment: "dev",
          mongo: {
            uri: "mongodb+srv://travellier.example/database",
            databaseName: "travellier_dev",
          },
          jwtSecret,
          photoBucketName: "travellier-dev-photos",
        }),
      });

      const response = await handler({
        rawPath: "/trips",
        headers: authorization === undefined ? {} : { authorization },
        requestContext: { http: { method: "GET" } },
      });

      expect(response).toMatchObject({
        statusCode: 401,
        body: JSON.stringify({ error: "Unauthorized" }),
      });
    },
  );

  it("passes the authenticated user to private handlers instead of reading it from the body", async () => {
    let receivedRequest: unknown;
    const handler = createLambdaHandler({
      loadRuntimeConfig: async () => ({
        environment: "dev",
        mongo: {
          uri: "mongodb+srv://travellier.example/database",
          databaseName: "travellier_dev",
        },
        jwtSecret,
        photoBucketName: "travellier-dev-photos",
      }),
      handleRequest: async (request) => {
        receivedRequest = request;

        return {
          statusCode: 204,
          headers: {},
          body: "",
        };
      },
    });

    const response = await handler({
      rawPath: "/trips",
      headers: { authorization: `Bearer ${createAccessToken(authenticatedUserId)}` },
      body: JSON.stringify({ userId: "507f191e810c19729de860ea" }),
      requestContext: { http: { method: "POST" } },
    });

    expect(response.statusCode).toBe(204);
    expect(receivedRequest).toEqual({
      method: "POST",
      url: "/trips",
      authenticatedUserId,
    });
  });
});
