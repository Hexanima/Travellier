import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { describe, expect, it } from "vitest";

import { createSecretsManagerSecretValueReader } from "./secrets-manager-reader.js";

describe("Secrets Manager reader", () => {
  it("reads the string value for the requested secret", async () => {
    const commands: GetSecretValueCommand[] = [];
    const client = {
      send: async (command: GetSecretValueCommand) => {
        commands.push(command);
        return { SecretString: "secret-value" };
      },
    } as unknown as SecretsManagerClient;

    const reader = createSecretsManagerSecretValueReader(client);

    await expect(reader.getSecretValue("arn:aws:secretsmanager:secret")).resolves.toBe(
      "secret-value",
    );
    expect(commands).toHaveLength(1);
    expect(commands[0]?.input).toEqual({
      SecretId: "arn:aws:secretsmanager:secret",
    });
  });

  it("rejects a secret without a string value", async () => {
    const client = {
      send: async () => ({}),
    } as unknown as SecretsManagerClient;

    const reader = createSecretsManagerSecretValueReader(client);

    await expect(reader.getSecretValue("arn:aws:secretsmanager:secret")).rejects.toThrow(
      "Secret arn:aws:secretsmanager:secret does not have a string value",
    );
  });
});
