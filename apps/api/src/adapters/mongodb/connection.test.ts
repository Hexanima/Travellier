import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";

import {
  connectMongoDatabase,
  readMongoDatabaseConfig,
} from "./connection.js";

describe("MongoDB connection configuration", () => {
  it("reads the required connection settings", () => {
    expect(
      readMongoDatabaseConfig({
        MONGODB_URI: "mongodb://localhost:27017",
        MONGODB_DATABASE: "travellier",
      }),
    ).toEqual({
      uri: "mongodb://localhost:27017",
      databaseName: "travellier",
    });
  });

  it("rejects a missing MongoDB URI", () => {
    expect(() => readMongoDatabaseConfig({ MONGODB_DATABASE: "travellier" })).toThrow(
      "MONGODB_URI is required",
    );
  });

  it("rejects a missing MongoDB database name", () => {
    expect(() => readMongoDatabaseConfig({ MONGODB_URI: "mongodb://localhost" })).toThrow(
      "MONGODB_DATABASE is required",
    );
  });
});

describe("MongoDB connection adapter", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
  });

  afterAll(async () => {
    await server?.stop();
  });

  it("connects to the configured database and closes the client", async () => {
    const connection = await connectMongoDatabase({
      uri: server.getUri(),
      databaseName: "travellier_test",
    });

    await connection.database.collection("health").insertOne({ ready: true });
    expect(await connection.database.collection("health").countDocuments()).toBe(1);

    await connection.close();
  });
});
