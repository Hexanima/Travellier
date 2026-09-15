import {
  MongoServerError,
  type Db,
  type IndexDescription,
} from "mongodb";

export const MONGO_MIGRATION_ID = "0001-create-prd-schema";

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

  if (await migrations.findOne({ id: MONGO_MIGRATION_ID })) {
    return;
  }

  for (const schema of collectionSchemas) {
    await ensureCollection(database, schema.name);
    await database.collection(schema.name).createIndexes(schema.indexes);
  }

  try {
    await migrations.insertOne({ id: MONGO_MIGRATION_ID, appliedAt: new Date() });
  } catch (error) {
    if (!(error instanceof MongoServerError) || error.code !== 11000) {
      throw error;
    }
  }
};
