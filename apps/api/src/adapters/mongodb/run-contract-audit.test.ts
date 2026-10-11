import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import * as connectionAdapter from "./connection.js";
import { runMongoContractAudit } from "./run-contract-audit.js";
import { legacyIds, seedVersion3Fixture, snapshotDocuments } from "../../../test/legacy-contract-fixture.js";

let server: MongoMemoryServer;
let client: MongoClient;
let database: Db;
let counter = 0;
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = await new MongoClient(server.getUri()).connect();
});
beforeEach(() => { database = client.db(`audit_runner_${++counter}`); });
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await client?.close(); await server?.stop(); });

const cli = (uri = server.getUri()) => spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./run-contract-audit.ts", import.meta.url))], {
  cwd: fileURLToPath(new URL("../../../", import.meta.url)),
  env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
    MONGODB_URI: uri, MONGODB_DATABASE_NAME: database.databaseName },
  encoding: "utf8", timeout: 15_000,
});

describe("MongoDB contract audit runner", () => {
  it("returns structured diagnostics through the real connection adapter without writes", async () => {
    await seedVersion3Fixture(database);
    const before = await snapshotDocuments(database);
    const report = await runMongoContractAudit({ uri: server.getUri(), databaseName: database.databaseName });
    expect(report.findings).toContainEqual(expect.objectContaining({ documentId: legacyIds.multipleLinks, code: "post_multiple_links" }));
    expect(await snapshotDocuments(database)).toEqual(before);
  });

  it.each(["success", "failure"])("closes the actual MongoDB connection on %s", async (outcome) => {
    const connect = connectionAdapter.connectMongoDatabase;
    const closed = vi.fn();
    vi.spyOn(connectionAdapter, "connectMongoDatabase").mockImplementation(async (config) => {
      const connection = await connect(config);
      return { ...connection, close: async () => { await connection.close(); closed(); } };
    });
    const result = runMongoContractAudit({ uri: server.getUri(), databaseName: outcome === "success" ? database.databaseName : "invalid/name" });
    if (outcome === "success") await result;
    else await expect(result).rejects.toThrow();
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("prints BSON identities as JSON and exits 2 when contracts need attention", async () => {
    await seedVersion3Fixture(database);
    const result = cli();
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).findings).toContainEqual(expect.objectContaining({ documentId: legacyIds.multipleLinks.toHexString(), tripId: legacyIds.trip.toHexString(), code: "post_multiple_links" }));
  }, 20_000);

  it("prints an empty report and exits 0 without initializing schema", async () => {
    const result = cli();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ findings: [] });
    expect(await database.listCollections().toArray()).toEqual([]);
  }, 20_000);

  it("exits 1 on operational failure without printing connection settings", () => {
    const result = cli("invalid-uri-with-secret");
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("MongoDB contract audit failed.");
    expect(result.stderr).not.toContain("invalid-uri-with-secret");
  }, 20_000);
});
