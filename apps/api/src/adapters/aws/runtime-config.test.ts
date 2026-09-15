import { describe, expect, it } from "vitest";

import { readLambdaRuntimeConfig } from "./runtime-config.js";

describe("Lambda runtime configuration", () => {
  const environment = {
    APP_ENV: "dev",
    MONGODB_SECRET_ARN: "arn:aws:secretsmanager:us-east-1:123456789012:secret:mongo",
    JWT_SECRET_ARN: "arn:aws:secretsmanager:us-east-1:123456789012:secret:jwt",
    S3_BUCKET_NAME: "travellier-dev-photos",
  };

  it("loads MongoDB and JWT settings from their configured secrets", async () => {
    const requestedSecretIds: string[] = [];

    const config = await readLambdaRuntimeConfig(environment, {
      getSecretValue: async (secretId) => {
        requestedSecretIds.push(secretId);

        if (secretId === environment.MONGODB_SECRET_ARN) {
          return JSON.stringify({
            uri: "mongodb+srv://travellier.example/database",
            databaseName: "travellier_dev",
          });
        }

        return "jwt-signing-secret";
      },
    });

    expect(requestedSecretIds).toEqual([
      environment.MONGODB_SECRET_ARN,
      environment.JWT_SECRET_ARN,
    ]);
    expect(config).toEqual({
      environment: "dev",
      mongo: {
        uri: "mongodb+srv://travellier.example/database",
        databaseName: "travellier_dev",
      },
      jwtSecret: "jwt-signing-secret",
      photoBucketName: "travellier-dev-photos",
    });
  });

  it("rejects an incomplete MongoDB secret without exposing its value", async () => {
    await expect(
      readLambdaRuntimeConfig(environment, {
        getSecretValue: async () => JSON.stringify({ uri: "mongodb://private" }),
      }),
    ).rejects.toThrow("MongoDB secret must include uri and databaseName");
  });

  it("rejects missing runtime settings", async () => {
    await expect(
      readLambdaRuntimeConfig(
        { ...environment, S3_BUCKET_NAME: "" },
        { getSecretValue: async () => "secret" },
      ),
    ).rejects.toThrow("S3_BUCKET_NAME is required");
  });
});
