import type { MongoDatabaseConfig } from "../mongodb/connection.js";

export interface SecretValueReader {
  getSecretValue: (secretId: string) => Promise<string>;
}

export interface LambdaRuntimeConfig {
  environment: string;
  mongo: MongoDatabaseConfig;
  jwtSecret: string;
  photoBucketName: string;
}

type RuntimeEnvironment = Record<string, string | undefined>;

const requiredSetting = (
  environment: RuntimeEnvironment,
  name: keyof RuntimeEnvironment,
): string => {
  const value = environment[name]?.trim();

  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }

  return value;
};

const readMongoSecret = (secret: string): MongoDatabaseConfig => {
  let value: unknown;

  try {
    value = JSON.parse(secret);
  } catch {
    throw new Error("MongoDB secret must be valid JSON");
  }

  const secretConfiguration = value as Record<string, unknown>;

  if (
    typeof value !== "object" ||
    value === null ||
    typeof secretConfiguration.uri !== "string" ||
    secretConfiguration.uri.trim() === "" ||
    typeof secretConfiguration.databaseName !== "string" ||
    secretConfiguration.databaseName.trim() === ""
  ) {
    throw new Error("MongoDB secret must include uri and databaseName");
  }

  return {
    uri: secretConfiguration.uri.trim(),
    databaseName: secretConfiguration.databaseName.trim(),
  };
};

export const readLambdaRuntimeConfig = async (
  environment: RuntimeEnvironment,
  secretValueReader: SecretValueReader,
): Promise<LambdaRuntimeConfig> => {
  const appEnvironment = requiredSetting(environment, "APP_ENV");
  const mongoSecretArn = requiredSetting(environment, "MONGODB_SECRET_ARN");
  const jwtSecretArn = requiredSetting(environment, "JWT_SECRET_ARN");
  const photoBucketName = requiredSetting(environment, "S3_BUCKET_NAME");
  const [mongoSecret, jwtSecret] = await Promise.all([
    secretValueReader.getSecretValue(mongoSecretArn),
    secretValueReader.getSecretValue(jwtSecretArn),
  ]);

  if (jwtSecret.trim() === "") {
    throw new Error("JWT secret must not be empty");
  }

  return {
    environment: appEnvironment,
    mongo: readMongoSecret(mongoSecret),
    jwtSecret,
    photoBucketName,
  };
};
