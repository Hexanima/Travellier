import { afterEach, describe, expect, it, vi } from "vitest";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import { migrateMongoSchema } from "../src/adapters/mongodb/migrations.js";
import { assertIsolatedEnvironment, startE2EHarness } from "./e2e-harness.js";

vi.mock("../src/adapters/mongodb/migrations.js", () => ({ migrateMongoSchema: vi.fn() }));

/** A stand-in for the in-memory replica set: no mongod is started, only the calls the harness makes are recorded. */
const fakeReplSet = () => {
  const stop = vi.fn(async () => undefined);
  const replSet = { getUri: () => "mongodb://127.0.0.1:1/?replicaSet=rs0", stop } as unknown as MongoMemoryReplSet;
  vi.spyOn(MongoMemoryReplSet, "create").mockResolvedValue(replSet);
  vi.spyOn(MongoClient.prototype, "connect").mockResolvedValue(undefined as never);
  return { stop };
};

describe("harness cleanup when something fails (T103)", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.mocked(migrateMongoSchema).mockReset(); });

  it("stops the replica set and closes the client when the setup fails after the mongod was created", async () => {
    const { stop } = fakeReplSet();
    const closeClient = vi.spyOn(MongoClient.prototype, "close").mockResolvedValue(undefined);
    vi.mocked(migrateMongoSchema).mockRejectedValue(new Error("migration failed"));
    await expect(startE2EHarness("cleanup")).rejects.toThrow("migration failed");
    expect(stop).toHaveBeenCalledTimes(1);
    expect(closeClient).toHaveBeenCalledTimes(1);
  });

  it("close() attempts every step even if the server close fails, and rethrows the first error", async () => {
    const { stop } = fakeReplSet();
    const closeClient = vi.spyOn(MongoClient.prototype, "close").mockResolvedValue(undefined);
    vi.mocked(migrateMongoSchema).mockResolvedValue(undefined as never);
    const harness = await startE2EHarness("cleanup");
    const realClose = harness.server.close.bind(harness.server);
    vi.spyOn(harness.server, "close").mockImplementation(((callback: (error?: Error) => void) => {
      realClose(); // really release the port; the callback reports the injected failure
      callback(new Error("server close failed"));
      return harness.server;
    }) as never);
    await expect(harness.close()).rejects.toThrow("server close failed");
    expect(closeClient).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe("isolation guard of the integrated API journeys (T103)", () => {
  const isolated = { MONGODB_URI: "mongodb://127.0.0.1:27017/?replicaSet=rs0", MONGODB_DATABASE_NAME: "t103_journey" };

  it("accepts only the loopback in-memory database with the t103_ prefix and no bucket", () => {
    expect(() => assertIsolatedEnvironment(isolated)).not.toThrow();
    expect(() => assertIsolatedEnvironment({ ...isolated, MONGODB_URI: "mongodb://localhost:50000/" })).not.toThrow();
  });

  it.each([
    ["an Atlas URI", { MONGODB_URI: "mongodb+srv://user:secret@cluster0.example.mongodb.net/app" }],
    ["a remote host", { MONGODB_URI: "mongodb://db.example.com:27017/" }],
    ["credentials in the URI", { MONGODB_URI: "mongodb://user:secret@127.0.0.1:27017/" }],
    ["a missing URI", { MONGODB_URI: undefined }],
    ["a database without the prefix", { MONGODB_DATABASE_NAME: "travellier" }],
    ["a configured bucket", { S3_BUCKET_NAME: "some-real-bucket" }],
  ])("refuses %s", (_label, override) => {
    expect(() => assertIsolatedEnvironment({ ...isolated, ...override })).toThrow();
  });
});
