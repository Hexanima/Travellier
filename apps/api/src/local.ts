import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "./app.js";
import {
  connectMongoDatabase,
  readMongoDatabaseConfig,
} from "./adapters/mongodb/connection.js";
import { createMongoRateLimitRepository } from "./adapters/mongodb/rate-limit-repository.js";
import { createAuthRateLimiter } from "./security/auth-rate-limit.js";
import { readSecurityConfig } from "./security/request-limits.js";
import { createAuthenticationApi } from "./auth/authentication-api.js";
import { createS3ObjectStorage } from "./adapters/aws/s3-object-storage.js";
import { createJwtMiddleware } from "./auth/jwt-middleware.js";
import { createPushDeviceApi } from "./push/push-device-api.js";
import { createTripApi } from "./trips/trip-api.js";
import { loadApiEnvironment } from "./load-env.js";

type LocalEnvironment = Record<string, string | undefined>;

const requiredSetting = (environment: LocalEnvironment, name: string): string => {
  const value = environment[name]?.trim();

  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }

  return value;
};

export const createLocalApi = async (
  environment: LocalEnvironment = process.env,
) => {
  const connection = await connectMongoDatabase(readMongoDatabaseConfig(environment));
  const jwtSecret = requiredSetting(environment, "JWT_SECRET");
  const security = readSecurityConfig(environment);
  const logLine = environment.API_VERBOSE === "false" ? undefined : (entry: unknown) => console.log(JSON.stringify(entry));
  const rateLimiter = security.rateLimitEnabled
    ? createAuthRateLimiter({
      port: createMongoRateLimitRepository(connection.database),
      secret: jwtSecret,
      config: security.authRateLimit,
      onError: (errorName) => logLine?.({ event: "rate-limit-error", errorName }),
    })
    : undefined;
  const app = createApp({
    auth: createAuthenticationApi({
      database: connection.database,
      jwtSecret,
      ...(environment.S3_BUCKET_NAME ? { storage: createS3ObjectStorage({ bucketName: environment.S3_BUCKET_NAME }) } : {}),
    }),
    // Without S3_BUCKET_NAME the local API runs without AWS: photo endpoints answer 500 and posts without photos work.
    trips: createTripApi(connection.database, environment.S3_BUCKET_NAME
      ? { storage: createS3ObjectStorage({ bucketName: environment.S3_BUCKET_NAME }) } : {}),
    pushDevices: createPushDeviceApi(connection.database),
    ...(rateLimiter === undefined ? {} : { rateLimiter }),
  }, createJwtMiddleware({ jwtSecret }), logLine,
  environment.CORS_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean), security);

  return {
    app,
    close: connection.close,
  };
};

const isEntrypoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  loadApiEnvironment();
  const port = Number(process.env.PORT ?? 3000);

  void createLocalApi()
    .then(({ app }) => {
      app.listen(port, () => {
        console.log(`API listening on http://localhost:${port}`);
      });
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
