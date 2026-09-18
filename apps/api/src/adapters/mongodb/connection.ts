import { MongoClient, type Db } from "mongodb";

export interface MongoDatabaseConfig {
  uri: string;
  databaseName: string;
}

export interface MongoDatabaseConnection {
  database: Db;
  close: () => Promise<void>;
}

type MongoEnvironment = Record<string, string | undefined>;

const requiredSetting = (
  environment: MongoEnvironment,
  name: keyof MongoEnvironment,
): string => {
  const value = environment[name]?.trim();

  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }

  return value;
};

export const readMongoDatabaseConfig = (
  environment: MongoEnvironment = process.env,
): MongoDatabaseConfig => ({
  uri: requiredSetting(environment, "MONGODB_URI"),
  databaseName: requiredSetting(environment, "MONGODB_DATABASE_NAME"),
});

export const connectMongoDatabase = async (
  config: MongoDatabaseConfig,
): Promise<MongoDatabaseConnection> => {
  const client = new MongoClient(config.uri);

  try {
    await client.connect();
  } catch (error) {
    await client.close();
    throw error;
  }

  return {
    database: client.db(config.databaseName),
    close: () => client.close(),
  };
};
