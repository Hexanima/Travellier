import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  connectMongoDatabase,
  readMongoDatabaseConfig,
  type MongoDatabaseConfig,
} from "./connection.js";
import { migrateMongoSchema } from "./migrations.js";

export const runMongoMigrations = async (
  config: MongoDatabaseConfig,
): Promise<void> => {
  const connection = await connectMongoDatabase(config);

  try {
    await migrateMongoSchema(connection.database);
  } finally {
    await connection.close();
  }
};

const isEntrypoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  runMongoMigrations(readMongoDatabaseConfig()).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
