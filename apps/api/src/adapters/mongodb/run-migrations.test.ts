import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";

import { MONGO_MIGRATION_ID } from "./migrations.js";
import { runMongoMigrations } from "./run-migrations.js";

describe("MongoDB migration runner", () => {
  let server: MongoMemoryServer;
  let client: MongoClient;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = new MongoClient(server.getUri());
    await client.connect();
  });

  afterAll(async () => {
    await client?.close();
    await server?.stop();
  });

  it("runs the schema migration through the connection adapter", async () => {
    await runMongoMigrations({
      uri: server.getUri(),
      databaseName: "travellier_test",
    });

    expect(
      await client
        .db("travellier_test")
        .collection("_migrations")
        .findOne({ id: MONGO_MIGRATION_ID }),
    ).toEqual(expect.objectContaining({ id: MONGO_MIGRATION_ID }));
  });
});
