import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db, type IndexDescription } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";

import {
  MONGO_MIGRATION_ID,
  JOURNEY_MIGRATION_ID,
  ITINERARY_MIGRATION_ID,
  POST_PHOTO_MIGRATION_ID,
  STORAGE_DELETION_MIGRATION_ID,
  migrateMongoSchema,
} from "./migrations.js";
import { OUTBOX_MIGRATION_ID, PUBLICATION_AGENDA_MIGRATION_ID } from "./pending-contract-migrations.js";

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
    { key: { tripId: 1, createdAt: -1 }, name: "tripId_createdAt_desc" },
    { key: { activityId: 1 }, name: "activityId" },
    { key: { parentPostId: 1 }, name: "parentPostId" },
    { key: { transportId: 1 }, name: "transportId" },
  ],
  postPhotos: [
    { key: { postId: 1 }, name: "postId" },
    { key: { s3Key: 1 }, name: "s3Key_unique", unique: true },
    { key: { postId: 1, order: 1 }, name: "postId_order_unique", unique: true },
  ],
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
      [...prdCollections, "outboxEvents", "storageDeletionJobs", "_migrations"].sort(),
    );
    expect((await database.collection("_migrations").find().toArray()).map(({ id }) => id).sort()).toEqual(
      [MONGO_MIGRATION_ID, JOURNEY_MIGRATION_ID, ITINERARY_MIGRATION_ID, POST_PHOTO_MIGRATION_ID, STORAGE_DELETION_MIGRATION_ID,
        PUBLICATION_AGENDA_MIGRATION_ID, OUTBOX_MIGRATION_ID].sort(),
    );
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
    expect(await database.collection("_migrations").countDocuments({ id: JOURNEY_MIGRATION_ID })).toBe(1);
    expect(await database.collection("_migrations").countDocuments({ id: ITINERARY_MIGRATION_ID })).toBe(1);
    expect(await database.collection("_migrations").countDocuments({ id: POST_PHOTO_MIGRATION_ID })).toBe(1);
  });

  it("adds the post photo indexes to a database migrated before them, keeping the postId index", async () => {
    await migrateMongoSchema(database);
    const photos = database.collection("postPhotos");
    await photos.dropIndex("s3Key_unique");
    await photos.dropIndex("postId_order_unique");
    await database.collection("_migrations").deleteOne({ id: POST_PHOTO_MIGRATION_ID });
    await migrateMongoSchema(database);
    const indexes = await photos.listIndexes().toArray();
    expect(indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: { postId: 1 }, name: "postId" }),
      expect.objectContaining({ key: { s3Key: 1 }, name: "s3Key_unique", unique: true }),
      expect.objectContaining({ key: { postId: 1, order: 1 }, name: "postId_order_unique", unique: true }),
    ]));
    await photos.insertOne({ postId: "p", order: 1, s3Key: "a" });
    await expect(photos.insertOne({ postId: "q", order: 1, s3Key: "a" })).rejects.toMatchObject({ code: 11000 });
    await expect(photos.insertOne({ postId: "p", order: 1, s3Key: "b" })).rejects.toMatchObject({ code: 11000 });
    await photos.insertOne({ postId: "p", order: 2, s3Key: "b" });
  });

  it("adds the storage deletion job indexes and backfills legacy jobs without deleting anything", async () => {
    await migrateMongoSchema(database);
    const jobs = database.collection("storageDeletionJobs");
    await database.collection("_migrations").deleteOne({ id: STORAGE_DELETION_MIGRATION_ID });
    for (const name of ["status_nextAttemptAt", "tripId"]) await jobs.dropIndex(name);
    const createdAt = new Date("2026-11-01T00:00:00.000Z"), tripId = new ObjectId();
    const legacy = await jobs.insertOne({ tripId, objectKeys: ["a", "b"], createdAt });
    const current = await jobs.insertOne({ tripId, objectKeys: ["c"], createdAt, status: "failed", attempts: 10, resolvedKeys: ["c"], rejectedKeys: [],
      nextAttemptAt: new Date("2026-11-02T00:00:00.000Z"), lastErrorCode: "delete_failed" });
    await migrateMongoSchema(database);
    expect(await jobs.countDocuments({})).toBe(2);
    expect(await jobs.findOne({ _id: legacy.insertedId })).toEqual({ _id: legacy.insertedId, tripId, objectKeys: ["a", "b"], createdAt,
      status: "pending", attempts: 0, resolvedKeys: [], rejectedKeys: [], nextAttemptAt: createdAt });
    expect(await jobs.findOne({ _id: current.insertedId })).toEqual({ _id: current.insertedId, tripId, objectKeys: ["c"], createdAt, status: "failed",
      attempts: 10, resolvedKeys: ["c"], rejectedKeys: [], nextAttemptAt: new Date("2026-11-02T00:00:00.000Z"), lastErrorCode: "delete_failed" });
    expect(await jobs.listIndexes().toArray()).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: { status: 1, nextAttemptAt: 1 }, name: "status_nextAttemptAt" }),
      expect.objectContaining({ key: { tripId: 1 }, name: "tripId" }),
    ]));
  });

  it("keeps the storage deletion migration idempotent over two runs", async () => {
    await migrateMongoSchema(database);
    const jobs = database.collection("storageDeletionJobs");
    await jobs.insertOne({ tripId: new ObjectId(), objectKeys: ["a"], createdAt: new Date("2026-11-01T00:00:00.000Z"), status: "pending", attempts: 3, resolvedKeys: ["a"], rejectedKeys: [],
      nextAttemptAt: new Date("2026-11-05T00:00:00.000Z") });
    const before = await jobs.find({}).toArray();
    await migrateMongoSchema(database);
    expect(await jobs.find({}).toArray()).toEqual(before);
    expect(await database.collection("_migrations").countDocuments({ id: STORAGE_DELETION_MIGRATION_ID })).toBe(1);
    expect((await jobs.listIndexes().toArray()).map((index) => index.name).sort()).toEqual(["_id_", "status_nextAttemptAt", "tripId"]);
  });

  it("enforces itinerary identity while allowing different types and destinations on one date", async () => {
    await migrateMongoSchema(database);
    const collection = database.collection("itineraryDays");
    const day = { tripId: "trip", destinationId: "destination", date: new Date("2026-09-25T00:00:00Z"), type: "activity", order: 1 };
    await collection.insertOne({ ...day });
    await expect(collection.insertOne({ ...day, order: 2 })).rejects.toMatchObject({ code: 11000 });
    await collection.insertOne({ ...day, type: "transit_out", order: 2 });
    await collection.insertOne({ ...day, destinationId: "other", order: 3 });
    expect(await collection.countDocuments({})).toBe(3);
  });

  it("refuses historical duplicate itinerary identities without deleting their references", async () => {
    await migrateMongoSchema(database);
    const collection = database.collection("itineraryDays");
    const indexes = await collection.listIndexes().toArray();
    for (const index of indexes.filter((index) => index.unique && index.name !== "_id_")) await collection.dropIndex(index.name!);
    await database.collection("_migrations").deleteOne({ id: "0003-unique-itinerary-identity" });
    const day = { tripId: "trip", destinationId: "destination", date: new Date("2026-09-25T00:00:00Z"), type: "activity" };
    const inserted = await collection.insertMany([{ ...day }, { ...day }]);
    await database.collection("posts").insertOne({ dayId: inserted.insertedIds[0] });
    await expect(migrateMongoSchema(database)).rejects.toThrow("Duplicate itinerary identities");
    expect(await collection.countDocuments({})).toBe(2);
    expect(await database.collection("posts").countDocuments({})).toBe(1);
    expect(await database.collection("_migrations").countDocuments({ id: "0003-unique-itinerary-identity" })).toBe(0);
  });

  it("enforces unique destination positions per Trip and transport directions per destination", async () => {
    await migrateMongoSchema(database);
    const destinations = database.collection("destinations");
    await destinations.insertOne({ tripId: "trip-a", order: 1 });
    await expect(destinations.insertOne({ tripId: "trip-a", order: 1 })).rejects.toMatchObject({ code: 11000 });
    await destinations.insertOne({ tripId: "trip-b", order: 1 });
    const transports = database.collection("transports");
    await transports.insertOne({ destinationId: "destination-a", direction: "outbound" });
    await expect(transports.insertOne({ destinationId: "destination-a", direction: "outbound" })).rejects.toMatchObject({ code: 11000 });
    await transports.insertOne({ destinationId: "destination-a", direction: "return" });
  });

  it("does not replace the old destination index when existing positions collide", async () => {
    await migrateMongoSchema(database);
    await database.collection("_migrations").deleteOne({ id: JOURNEY_MIGRATION_ID });
    await database.collection("destinations").dropIndex("tripId_order");
    await database.collection("destinations").createIndex({ tripId: 1, order: 1 }, { name: "tripId_order" });
    await database.collection("destinations").insertMany([{ tripId: "trip-a", order: 1 }, { tripId: "trip-a", order: 1 }]);
    await expect(migrateMongoSchema(database)).rejects.toThrow("Duplicate destination positions");
    expect((await database.collection("destinations").listIndexes().toArray()).find((index) => index.name === "tripId_order")?.unique).not.toBe(true);
  });
});
