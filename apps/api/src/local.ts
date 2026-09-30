import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "./app.js";
import {
  connectMongoDatabase,
  readMongoDatabaseConfig,
} from "./adapters/mongodb/connection.js";
import { createAuthenticationApi } from "./auth/authentication-api.js";
import { createS3ObjectStorage } from "./adapters/aws/s3-object-storage.js";
import { createJwtMiddleware } from "./auth/jwt-middleware.js";
import { createTripApi } from "./trips/trip-api.js";

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
  const app = createApp({
    auth: createAuthenticationApi({
      database: connection.database,
      jwtSecret,
      ...(environment.S3_BUCKET_NAME ? { storage: createS3ObjectStorage({ bucketName: environment.S3_BUCKET_NAME }) } : {}),
    }),
    trips: createTripApi(connection.database),
  }, createJwtMiddleware({ jwtSecret }));

  return {
    app,
    close: connection.close,
  };
};

const isEntrypoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
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
