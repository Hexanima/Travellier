import {
  MongoServerError,
  type Db,
  type IndexDescription,
} from "mongodb";

export const MONGO_MIGRATION_ID = "0001-create-prd-schema";
export const JOURNEY_MIGRATION_ID = "0002-unique-journey-order-and-direction";
export const ITINERARY_MIGRATION_ID = "0003-unique-itinerary-identity";

type CollectionSchema = {
  name: string;
  indexes: IndexDescription[];
};

const collectionSchemas: CollectionSchema[] = [
  {
    name: "users",
    indexes: [{ key: { email: 1 }, name: "email_unique", unique: true }],
  },
  {
    name: "refreshTokens",
    indexes: [
      { key: { token: 1 }, name: "token" },
      { key: { userId: 1 }, name: "userId" },
      {
        key: { expiresAt: 1 },
        name: "expiresAt_ttl",
        expireAfterSeconds: 0,
      },
    ],
  },
  {
    name: "trips",
    indexes: [
      { key: { inviteCode: 1 }, name: "inviteCode_unique", unique: true },
      { key: { visibility: 1 }, name: "visibility" },
    ],
  },
  {
    name: "tripMembers",
    indexes: [
      {
        key: { tripId: 1, userId: 1 },
        name: "tripId_userId_unique",
        unique: true,
      },
      { key: { userId: 1 }, name: "userId" },
    ],
  },
  {
    name: "destinations",
    indexes: [{ key: { tripId: 1, order: 1 }, name: "tripId_order" }],
  },
  {
    name: "transports",
    indexes: [
      { key: { tripId: 1 }, name: "tripId" },
      { key: { destinationId: 1 }, name: "destinationId" },
    ],
  },
  {
    name: "itineraryDays",
    indexes: [{ key: { tripId: 1, order: 1 }, name: "tripId_order" }],
  },
  {
    name: "activities",
    indexes: [
      { key: { tripId: 1 }, name: "tripId" },
      { key: { dayId: 1 }, name: "dayId" },
    ],
  },
  {
    name: "activityParticipations",
    indexes: [
      {
        key: { activityId: 1, userId: 1 },
        name: "activityId_userId_unique",
        unique: true,
      },
    ],
  },
  {
    name: "activityVotes",
    indexes: [
      {
        key: { activityId: 1, userId: 1 },
        name: "activityId_userId_unique",
        unique: true,
      },
    ],
  },
  {
    name: "posts",
    indexes: [
      { key: { tripId: 1 }, name: "tripId" },
      { key: { dayId: 1 }, name: "dayId" },
      { key: { activityId: 1 }, name: "activityId" },
      { key: { parentPostId: 1 }, name: "parentPostId" },
      { key: { transportId: 1 }, name: "transportId" },
    ],
  },
  {
    name: "postPhotos",
    indexes: [{ key: { postId: 1 }, name: "postId" }],
  },
  {
    name: "postExpenses",
    indexes: [{ key: { postId: 1 }, name: "postId_unique", unique: true }],
  },
  {
    name: "postLikes",
    indexes: [
      {
        key: { postId: 1, userId: 1 },
        name: "postId_userId_unique",
        unique: true,
      },
    ],
  },
  {
    name: "comments",
    indexes: [{ key: { postId: 1, createdAt: 1 }, name: "postId_createdAt" }],
  },
  {
    name: "commentLikes",
    indexes: [
      {
        key: { commentId: 1, userId: 1 },
        name: "commentId_userId_unique",
        unique: true,
      },
    ],
  },
];

const migrationCollectionName = "_migrations";

const collectionExists = async (database: Db, name: string): Promise<boolean> => {
  const collection = await database
    .listCollections({ name }, { nameOnly: true })
    .next();

  return collection !== null;
};

const ensureCollection = async (database: Db, name: string): Promise<void> => {
  if (await collectionExists(database, name)) {
    return;
  }

  try {
    await database.createCollection(name);
  } catch (error) {
    if (!(error instanceof MongoServerError) || error.code !== 48) {
      throw error;
    }
  }
};

export const migrateMongoSchema = async (database: Db): Promise<void> => {
  await ensureCollection(database, migrationCollectionName);

  const migrations = database.collection<{ id: string; appliedAt: Date }>(
    migrationCollectionName,
  );
  await migrations.createIndex({ id: 1 }, { name: "id_unique", unique: true });

  if (!(await migrations.findOne({ id: MONGO_MIGRATION_ID }))) {
    for (const schema of collectionSchemas) {
      await ensureCollection(database, schema.name);
      await database.collection(schema.name).createIndexes(schema.indexes);
    }
    await migrations.insertOne({ id: MONGO_MIGRATION_ID, appliedAt: new Date() });
  }

  if (!(await migrations.findOne({ id: JOURNEY_MIGRATION_ID }))) {
    const destinations = database.collection("destinations");
    const duplicates = await destinations.aggregate([
      { $group: { _id: { tripId: "$tripId", order: "$order" }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ]).next();
    if (duplicates !== null) throw new Error("Duplicate destination positions must be resolved before migration.");

    const indexes = await destinations.listIndexes().toArray();
    if (indexes.some((index) => index.name === "tripId_order" && index.unique !== true)) {
      await destinations.dropIndex("tripId_order");
    }
    await destinations.createIndex({ tripId: 1, order: 1 }, { name: "tripId_order", unique: true });
    await database.collection("transports").createIndex(
      { destinationId: 1, direction: 1 }, { name: "destinationId_direction_unique", unique: true },
    );
    await migrations.insertOne({ id: JOURNEY_MIGRATION_ID, appliedAt: new Date() });
  }

  if (!(await migrations.findOne({ id: ITINERARY_MIGRATION_ID }))) {
    const days = database.collection("itineraryDays");
    const duplicates = await days.aggregate([
      { $group: { _id: { tripId: "$tripId", destinationId: "$destinationId", date: "$date", type: "$type" }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ]).next();
    if (duplicates !== null) throw new Error("Duplicate itinerary identities must be resolved before migration.");
    await days.createIndex({ tripId: 1, destinationId: 1, date: 1, type: 1 }, { name: "itinerary_identity_unique", unique: true });
    await migrations.insertOne({ id: ITINERARY_MIGRATION_ID, appliedAt: new Date() });
  }
};
