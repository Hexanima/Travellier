import { describe, expect, it } from "vitest";

import { createLambdaHandler } from "./lambda.js";

describe("Lambda API handler", () => {
  it("returns the health response for an API Gateway request", async () => {
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
          jwtSecret: "jwt-signing-secret",
          photoBucketName: "travellier-dev-photos",
        };
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
    expect(runtimeConfigurationLoads).toBe(1);
  });
});
