import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

import type { SecretValueReader } from "./runtime-config.js";

export const createSecretsManagerSecretValueReader = (
  client: SecretsManagerClient = new SecretsManagerClient(),
): SecretValueReader => ({
  getSecretValue: async (secretId) => {
    const result = await client.send(
      new GetSecretValueCommand({ SecretId: secretId }),
    );

    if (result.SecretString === undefined) {
      throw new Error(`Secret ${secretId} does not have a string value`);
    }

    return result.SecretString;
  },
});
