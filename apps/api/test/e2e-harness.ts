import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createObjectId } from "app-domain";

import { migrateMongoSchema } from "../src/adapters/mongodb/migrations.js";
import { createApp } from "../src/app.js";
import { createAuthenticationApi } from "../src/auth/authentication-api.js";
import { createAuthenticationTokenAdapter } from "../src/auth/authentication-token-adapter.js";
import { createJwtMiddleware } from "../src/auth/jwt-middleware.js";
import { createPushDeviceApi } from "../src/push/push-device-api.js";
import { createTripApi } from "../src/trips/trip-api.js";
import { FakeCleanupStorage } from "./fake-cleanup-storage.js";
import { FakeObjectStorage } from "./fake-object-storage.js";

/** Every database created by the T103 journeys carries this prefix, so a leftover is recognizable as ours. */
export const E2E_DATABASE_PREFIX = "t103_";
const E2E_JWT_SECRET = "t103-isolated-secret-not-for-any-real-environment";
const HUNDRED_YEARS_MS = 100 * 365 * 24 * 3_600_000;

/**
 * Refuses to run against anything that is not the harness's own in-memory MongoDB and fake storage. It checks the environment the harness
 * itself composes (never `process.env`, never `loadApiEnvironment()`), so a real URI or bucket can never reach the app by accident.
 */
export const assertIsolatedEnvironment = (environment: Record<string, string | undefined>): void => {
  if (environment.S3_BUCKET_NAME !== undefined && environment.S3_BUCKET_NAME !== "") {
    throw new Error("Isolated tests must not set S3_BUCKET_NAME: object storage is always simulated.");
  }
  const uri = environment.MONGODB_URI;
  if (uri === undefined || !/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|\?|$)/.test(uri)) {
    throw new Error("Isolated tests only accept the loopback URI of their own in-memory MongoDB.");
  }
  if (uri.includes("@") || uri.includes("mongodb.net")) throw new Error("Isolated tests must not use credentials or Atlas hosts.");
  if (!(environment.MONGODB_DATABASE_NAME ?? "").startsWith(E2E_DATABASE_PREFIX)) {
    throw new Error(`Isolated tests only use databases prefixed with ${E2E_DATABASE_PREFIX}.`);
  }
};

export interface HttpResult { status: number; json: any; text: string; headers: Headers } // eslint-disable-line @typescript-eslint/no-explicit-any

export interface E2EHarness {
  replSet: MongoMemoryReplSet;
  client: MongoClient;
  db: Db;
  storage: FakeObjectStorage;
  cleanupStorage: FakeCleanupStorage;
  baseUrl: string;
  server: Server;
  /** Long-lived access token for an existing user id (used where the clock is moved, so no real login expires mid-journey). */
  tokenFor: (userId: string | ObjectId) => Promise<string>;
  /** Real HTTP request: JSON body, bearer token when given. */
  http: (token: string | null, method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<HttpResult>;
  register: (email: string, password: string, name?: string) => Promise<HttpResult>;
  login: (email: string, password: string) => Promise<HttpResult>;
  /** Every collection of the harness database, sorted by _id: the full state for "no writes" comparisons. */
  snapshot: (names?: string[]) => Promise<Record<string, unknown[]>>;
  close: () => Promise<void>;
}

/** Runs every step even when one fails, and rethrows the first error afterwards (so no mongod/socket outlives a failed step). */
const runAll = async (steps: Array<() => Promise<unknown>>): Promise<void> => {
  let failure: { error: unknown } | undefined;
  for (const step of steps) {
    try { await step(); } catch (error) { failure ??= { error }; }
  }
  if (failure !== undefined) throw failure.error;
};

export const startE2EHarness = async (name: string): Promise<E2EHarness> => {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  let client: MongoClient | undefined;
  let server: Server | undefined;
  try {
    return await composeHarness(name, replSet, (created) => { client = created; }, (created) => { server = created; });
  } catch (error) {
    // Partial cleanup: the in-memory mongod must not stay alive when the setup fails after it was created.
    const openServer = server, openClient = client;
    await runAll([
      async () => { if (openServer?.listening === true) await new Promise<void>((resolve, reject) => openServer.close((e) => e === undefined ? resolve() : reject(e))); },
      async () => { await openClient?.close(); },
      async () => { await replSet.stop(); },
    ]).catch(() => undefined);
    throw error;
  }
};

const composeHarness = async (name: string, replSet: MongoMemoryReplSet, onClient: (client: MongoClient) => void, onServer: (server: Server) => void): Promise<E2EHarness> => {
  const databaseName = `${E2E_DATABASE_PREFIX}${name}`;
  assertIsolatedEnvironment({ MONGODB_URI: replSet.getUri(), MONGODB_DATABASE_NAME: databaseName });
  const client = new MongoClient(replSet.getUri());
  onClient(client);
  await client.connect();
  const db = client.db(databaseName);
  await migrateMongoSchema(db);
  const storage = new FakeObjectStorage();
  const cleanupStorage = new FakeCleanupStorage();
  // Composed like src/local.ts, but with the fake storage injected and without the environment loader.
  const server = createApp({
    auth: createAuthenticationApi({ database: db, jwtSecret: E2E_JWT_SECRET, storage }),
    trips: createTripApi(db, { storage }),
    pushDevices: createPushDeviceApi(db),
  }, createJwtMiddleware({ jwtSecret: E2E_JWT_SECRET }));
  onServer(server);
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const tokens = createAuthenticationTokenAdapter({ jwtSecret: E2E_JWT_SECRET, accessTokenLifetimeMs: HUNDRED_YEARS_MS });

  const http: E2EHarness["http"] = async (token, method, path, body, headers = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token === null ? {} : { authorization: `Bearer ${token}` }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let json: unknown = null;
    try { json = text === "" ? null : JSON.parse(text); } catch { json = null; }
    return { status: response.status, json, text, headers: response.headers };
  };

  return {
    replSet, client, db, storage, cleanupStorage, baseUrl, server, http,
    tokenFor: async (userId) => {
      const id = createObjectId(userId.toString());
      if (!id.ok) throw id.error;
      const token = await tokens.createAccessToken(id.value);
      if (!token.ok) throw token.error;
      return token.value;
    },
    register: (email, password, userName) => http(null, "POST", "/auth/register", { email, password, ...(userName === undefined ? {} : { name: userName }) }),
    login: (email, password) => http(null, "POST", "/auth/login", { email, password }),
    snapshot: async (names) => {
      const collections = names ?? (await db.listCollections({}, { nameOnly: true }).toArray()).map((collection) => collection.name);
      return Object.fromEntries(await Promise.all(collections.map(async (collection) =>
        [collection, await db.collection(collection).find().sort({ _id: 1 }).toArray()] as const)));
    },
    close: () => runAll([
      () => new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error))),
      () => client.close(),
      () => replSet.stop(),
    ]),
  };
};
