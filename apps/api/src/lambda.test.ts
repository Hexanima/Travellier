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

  it("loads runtime configuration before processing a public authentication route", async () => {
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
      handleRequest: async () => ({ statusCode: 201, headers: {}, body: "" }),
    });

    const response = await handler({
      rawPath: "/auth/register",
      requestContext: { http: { method: "POST" } },
    });

    expect(response.statusCode).toBe(201);
    expect(runtimeConfigurationLoads).toBe(1);
  });

  it("builds the authentication API from runtime configuration for public authentication routes", async () => {
    const runtimeConfiguration = {
      environment: "dev",
      mongo: {
        uri: "mongodb+srv://travellier.example/database",
        databaseName: "travellier_dev",
      },
      jwtSecret,
      photoBucketName: "travellier-dev-photos",
    };
    const auth = { register: async () => ({ ok: true as const, value: {} }) };
    let factoryConfiguration: unknown;
    let receivedDependencies: unknown;
    const handler = createLambdaHandler({
      loadRuntimeConfig: async () => runtimeConfiguration,
      createAuthenticationApi: async (configuration: unknown) => {
        factoryConfiguration = configuration;
        return auth;
      },
      handleRequest: (async (_request: unknown, dependencies: unknown) => {
        receivedDependencies = dependencies;
        return { statusCode: 201, headers: {}, body: "" };
      }) as never,
    } as never);

    const response = await handler({
      rawPath: "/auth/register",
      requestContext: { http: { method: "POST" } },
    });

    expect(response.statusCode).toBe(201);
    expect(factoryConfiguration).toEqual(runtimeConfiguration);
    expect(receivedDependencies).toEqual({ auth });
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
      body: JSON.stringify({ userId: "507f191e810c19729de860ea" }),
      authenticatedUserId,
    });
  });

  it("passes the parsed profile update body and authenticated user to the private API", async () => {
    const auth = { updateProfile: async () => ({ ok: true as const, value: {} }) };
    let receivedRequest: unknown;
    let receivedDependencies: unknown;
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
      createAuthenticationApi: async () => auth as never,
      handleRequest: (async (request: unknown, dependencies: unknown) => {
        receivedRequest = request;
        receivedDependencies = dependencies;
        return { statusCode: 200, headers: {}, body: "" };
      }) as never,
    });

    const response = await handler({
      rawPath: "/profile",
      headers: { authorization: `Bearer ${createAccessToken(authenticatedUserId)}` },
      body: JSON.stringify({ name: "Nico", avatar: "avatars/nico.jpg" }),
      requestContext: { http: { method: "PATCH" } },
    });

    expect(response.statusCode).toBe(200);
    expect(receivedRequest).toEqual({
      method: "PATCH",
      url: "/profile",
      body: JSON.stringify({ name: "Nico", avatar: "avatars/nico.jpg" }),
      authenticatedUserId,
    });
    expect(receivedDependencies).toEqual({ auth });
  });

  it("passes the refresh token to the public logout route without requiring an access token", async () => {
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

        return { statusCode: 204, headers: {}, body: "" };
      },
    });

    const response = await handler({
      rawPath: "/auth/logout",
      body: JSON.stringify({ refreshToken: "refresh-token" }),
      requestContext: { http: { method: "POST" } },
    });

    expect(response.statusCode).toBe(204);
    expect(receivedRequest).toEqual({
      method: "POST",
      url: "/auth/logout",
      body: JSON.stringify({ refreshToken: "refresh-token" }),
    });
  });
});
