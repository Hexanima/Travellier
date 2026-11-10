import { describe, expect, it, vi } from "vitest";

import { readStorageDeletionRuntimeConfig } from "./storage-deletion-config.js";

describe("storage deletion runtime configuration", () => {
  const environment = {
    APP_ENV: "dev",
    MONGODB_SECRET_ARN: "arn:aws:secretsmanager:us-east-1:123456789012:secret:mongo",
    S3_BUCKET_NAME: "travellier-dev-photos",
  };
  const secret = JSON.stringify({ uri: "mongodb+srv://travellier.example/database", databaseName: "travellier_dev" });

  it("loads only the MongoDB secret and the bucket, without requiring a JWT secret", async () => {
    const getSecretValue = vi.fn().mockResolvedValue(secret);
    const config = await readStorageDeletionRuntimeConfig(environment, { getSecretValue });
    expect(getSecretValue).toHaveBeenCalledTimes(1);
    expect(getSecretValue).toHaveBeenCalledWith(environment.MONGODB_SECRET_ARN);
    expect(config).toEqual({ environment: "dev", mongo: { uri: "mongodb+srv://travellier.example/database", databaseName: "travellier_dev" },
      photoBucketName: "travellier-dev-photos" });
  });

  it.each(["APP_ENV", "MONGODB_SECRET_ARN", "S3_BUCKET_NAME"])("requires %s", async (name) => {
    const getSecretValue = vi.fn().mockResolvedValue(secret);
    await expect(readStorageDeletionRuntimeConfig({ ...environment, [name]: " " }, { getSecretValue })).rejects.toThrow(`${name} is required`);
    expect(getSecretValue).not.toHaveBeenCalled();
  });

  it("rejects a MongoDB secret that is not valid", async () => {
    await expect(readStorageDeletionRuntimeConfig(environment, { getSecretValue: async () => "not json" })).rejects.toThrow("MongoDB secret must be valid JSON");
    await expect(readStorageDeletionRuntimeConfig(environment, { getSecretValue: async () => "{}" })).rejects.toThrow("MongoDB secret must include uri and databaseName");
  });
});
