import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MongoClient, type Db, type IndexDescription } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";

import {
  MONGO_MIGRATION_ID,
  migrateMongoSchema,
} from "./migrations.js";

const prdCollections = [
  "users",
  "refreshTokens",
  "trips",
  "tripMembers",
  "destinations",
  "transports",
  "itineraryDays",
  "activities",
  "activityParticipations",
  "activityVotes",
  "posts",
  "postPhotos",
  "postExpenses",
  "postLikes",
  "comments",
  "commentLikes",
] as const;

const expectedIndexes: Record<string, IndexDescription[]> = {
  users: [{ key: { email: 1 }, name: "email_unique", unique: true }],
  refreshTokens: [
    { key: { token: 1 }, name: "token" },
    { key: { userId: 1 }, name: "userId" },
    {
      key: { expiresAt: 1 },
      name: "expiresAt_ttl",
      expireAfterSeconds: 0,
    },
  ],
  trips: [
    { key: { inviteCode: 1 }, name: "inviteCode_unique", unique: true },
    { key: { visibility: 1 }, name: "visibility" },
  ],
  tripMembers: [
    {
      key: { tripId: 1, userId: 1 },
      name: "tripId_userId_unique",
      unique: true,
    },
    { key: { userId: 1 }, name: "userId" },
  ],
  destinations: [{ key: { tripId: 1, order: 1 }, name: "tripId_order" }],
  transports: [
    { key: { tripId: 1 }, name: "tripId" },
    { key: { destinationId: 1 }, name: "destinationId" },
  ],
  itineraryDays: [{ key: { tripId: 1, order: 1 }, name: "tripId_order" }],
  activities: [
    { key: { tripId: 1 }, name: "tripId" },
    { key: { dayId: 1 }, name: "dayId" },
  ],
  activityParticipations: [
    {
      key: { activityId: 1, userId: 1 },
      name: "activityId_userId_unique",
      unique: true,
    },
  ],
  activityVotes: [
    {
      key: { activityId: 1, userId: 1 },
      name: "activityId_userId_unique",
      unique: true,
    },
  ],
  posts: [
    { key: { tripId: 1 }, name: "tripId" },
    { key: { dayId: 1 }, name: "dayId" },
    { key: { activityId: 1 }, name: "activityId" },
    { key: { parentPostId: 1 }, name: "parentPostId" },
    { key: { transportId: 1 }, name: "transportId" },
  ],
  postPhotos: [{ key: { postId: 1 }, name: "postId" }],
  postExpenses: [
    { key: { postId: 1 }, name: "postId_unique", unique: true },
  ],
  postLikes: [
    {
      key: { postId: 1, userId: 1 },
      name: "postId_userId_unique",
      unique: true,
    },
  ],
  comments: [{ key: { postId: 1, createdAt: 1 }, name: "postId_createdAt" }],
  commentLikes: [
    {
      key: { commentId: 1, userId: 1 },
      name: "commentId_userId_unique",
      unique: true,
    },
  ],
};

let server: MongoMemoryServer;
let client: MongoClient | undefined;
let database: Db;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  database = client.db("travellier_test");
}, 120_000);

afterEach(async () => {
  await database.dropDatabase();
});

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

describe("MongoDB schema migration", () => {
  it("creates every PRD collection and records its version", async () => {
    await migrateMongoSchema(database);

    const collections = await database
      .listCollections({}, { nameOnly: true })
      .toArray();

    expect(collections.map(({ name }) => name).sort()).toEqual(
      [...prdCollections, "_migrations"].sort(),
    );
    expect(await database.collection("_migrations").find().toArray()).toEqual([
      expect.objectContaining({ id: MONGO_MIGRATION_ID }),
    ]);
  });

  it("applies every PRD index, including refresh-token TTL", async () => {
    await migrateMongoSchema(database);

    for (const [collectionName, expected] of Object.entries(expectedIndexes)) {
      const indexes = await database.collection(collectionName).listIndexes().toArray();

      for (const index of expected) {
        expect(indexes).toContainEqual(expect.objectContaining(index));
      }
    }
  });

  it("enforces each PRD unique index", async () => {
    await migrateMongoSchema(database);

    for (const [collectionName, indexes] of Object.entries(expectedIndexes)) {
      for (const index of indexes.filter(({ unique }) => unique)) {
        const document = Object.fromEntries(
          Object.keys(index.key).map((field) => [field, `${collectionName}-${field}`]),
        );
        const collection = database.collection(collectionName);

        await collection.insertOne(document);
        await expect(collection.insertOne(document)).rejects.toMatchObject({
          code: 11000,
        });
      }
    }
  });

  it("is idempotent after its version was applied", async () => {
    await migrateMongoSchema(database);
    await migrateMongoSchema(database);

    expect(
      await database.collection("_migrations").countDocuments({
        id: MONGO_MIGRATION_ID,
      }),
    ).toBe(1);
  });
});
