import { describe, expect, it, vi } from "vitest";

import { readEventsRuntimeConfig } from "./events-config.js";

const ANDROID = "arn:aws:sns:us-east-1:123456789012:app/GCM/travellier-dev-android";
const IOS = "arn:aws:sns:us-east-1:123456789012:app/APNS_SANDBOX/travellier-dev-ios";
const environment = {
  APP_ENV: "dev",
  MONGODB_SECRET_ARN: "arn:aws:secretsmanager:us-east-1:123456789012:secret:mongo",
  PUSH_APPLICATIONS_SECRET_ARN: "arn:aws:secretsmanager:us-east-1:123456789012:secret:push-apps",
};
const mongoSecret = JSON.stringify({ uri: "mongodb+srv://travellier.example/database", databaseName: "travellier_dev" });
const registry = (over: Record<string, unknown> = {}) => JSON.stringify({ stage: "dev", android: ANDROID, ios: IOS, firebaseProjectId: "demo-project", ...over });
const reader = (push: string) => vi.fn(async (arn: string) => (arn === environment.MONGODB_SECRET_ARN ? mongoSecret : push));

describe("events worker runtime configuration", () => {
  it("loads the MongoDB secret and the SNS applications of the stage, without a JWT secret", async () => {
    const getSecretValue = reader(registry());
    const config = await readEventsRuntimeConfig(environment, { getSecretValue });
    expect(getSecretValue.mock.calls.map(([arn]) => arn).sort()).toEqual([environment.MONGODB_SECRET_ARN, environment.PUSH_APPLICATIONS_SECRET_ARN].sort());
    expect(config).toEqual({ environment: "dev", mongo: { uri: "mongodb+srv://travellier.example/database", databaseName: "travellier_dev" },
      pushApplications: { android: ANDROID, ios: IOS } });
  });

  it("accepts the production APNS application", async () => {
    const ios = "arn:aws:sns:us-east-1:123456789012:app/APNS/travellier-dev-ios";
    const config = await readEventsRuntimeConfig(environment, { getSecretValue: reader(registry({ ios })) });
    expect(config.pushApplications.ios).toBe(ios);
  });

  it.each(["APP_ENV", "MONGODB_SECRET_ARN", "PUSH_APPLICATIONS_SECRET_ARN"])("requires %s before reading any secret", async (name) => {
    const getSecretValue = reader(registry());
    await expect(readEventsRuntimeConfig({ ...environment, [name]: " " }, { getSecretValue })).rejects.toThrow(`${name} is required`);
    expect(getSecretValue).not.toHaveBeenCalled();
  });

  it("rejects a registry of another stage", async () => {
    await expect(readEventsRuntimeConfig(environment, { getSecretValue: reader(registry({ stage: "prod" })) })).rejects.toThrow("Push applications secret does not match APP_ENV");
  });

  it("rejects a secret ARN that is not a Secrets Manager ARN", async () => {
    await expect(readEventsRuntimeConfig({ ...environment, PUSH_APPLICATIONS_SECRET_ARN: "push-apps" }, { getSecretValue: reader(registry()) }))
      .rejects.toThrow("PUSH_APPLICATIONS_SECRET_ARN must be a Secrets Manager ARN");
  });

  it.each([
    ["not JSON", "not json"],
    ["a JSON scalar", "7"],
    ["a missing android ARN", registry({ android: undefined })],
    ["an android ARN of another stage", registry({ android: ANDROID.replace("dev", "prod") })],
    ["an android ARN of the wrong platform", registry({ android: ANDROID.replace("GCM", "APNS") })],
    ["an ios ARN with a wrong platform", registry({ ios: IOS.replace("APNS_SANDBOX", "GCM") })],
    ["an ios ARN of another stage", registry({ ios: IOS.replace("dev", "prod") })],
    ["a non-ARN value", registry({ ios: "travellier-dev-ios" })],
  ])("rejects %s without echoing its content", async (_name, secret) => {
    const failure = await readEventsRuntimeConfig(environment, { getSecretValue: reader(secret) }).then(() => undefined, (error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toContain("123456789012");
  });

  it("rejects a malformed MongoDB secret", async () => {
    await expect(readEventsRuntimeConfig(environment, { getSecretValue: async (arn) => (arn === environment.MONGODB_SECRET_ARN ? "{}" : registry()) }))
      .rejects.toThrow("MongoDB secret must include uri and databaseName");
  });
});
