import type { MongoDatabaseConfig } from "../mongodb/connection.js";
import { readMongoSecret, requiredSetting, type SecretValueReader } from "./runtime-config.js";

/** Configuration of the cleanup worker: its role reads only the MongoDB secret, so no JWT secret is requested. */
export interface StorageDeletionRuntimeConfig {
  environment: string;
  mongo: MongoDatabaseConfig;
  photoBucketName: string;
}

export const readStorageDeletionRuntimeConfig = async (
  environment: Record<string, string | undefined>,
  secretValueReader: SecretValueReader,
): Promise<StorageDeletionRuntimeConfig> => {
  const appEnvironment = requiredSetting(environment, "APP_ENV");
  const mongoSecretArn = requiredSetting(environment, "MONGODB_SECRET_ARN");
  const photoBucketName = requiredSetting(environment, "S3_BUCKET_NAME");
  return {
    environment: appEnvironment,
    mongo: readMongoSecret(await secretValueReader.getSecretValue(mongoSecretArn)),
    photoBucketName,
  };
};
