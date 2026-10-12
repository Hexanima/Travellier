import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MongoClient } from "mongodb";
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
        MONGODB_DATABASE_NAME: "travellier",
      }),
    ).toEqual({
      uri: "mongodb://localhost:27017",
      databaseName: "travellier",
    });
  });

  it("rejects a missing MongoDB URI", () => {
    expect(() => readMongoDatabaseConfig({ MONGODB_DATABASE_NAME: "travellier" })).toThrow(
      "MONGODB_URI is required",
    );
  });

  it("rejects a missing MongoDB database name", () => {
    expect(() => readMongoDatabaseConfig({ MONGODB_URI: "mongodb://localhost" })).toThrow(
      "MONGODB_DATABASE_NAME is required",
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

  it("closes a connected client when construction of Db rejects a dotted database name", async () => {
    const clients: MongoClient[] = [];
    const closed: MongoClient[] = [];
    const connect = MongoClient.prototype.connect;
    vi.spyOn(MongoClient.prototype, "connect").mockImplementation(async function (this: MongoClient) {
      clients.push(this);
      this.once("topologyClosed", () => closed.push(this));
      return connect.call(this);
    });
    try {
      await expect(connectMongoDatabase({ uri: server.getUri(), databaseName: "dev.audit" })).rejects.toThrow("Database names cannot contain the character '.'");
      expect(clients).toHaveLength(1);
      expect(closed).toEqual(clients);
    } finally {
      // Clean up the actual client even in the failing RED phase.
      await Promise.all(clients.map((client) => client.close()));
      vi.restoreAllMocks();
    }
  });
});
