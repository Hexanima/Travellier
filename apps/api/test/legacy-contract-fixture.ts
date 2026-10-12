import { ObjectId, type Db, type Document, type IndexDescription } from "mongodb";

// Snapshot of the applied 0001–0003 schema, independent of the current runner.
export const version3Indexes: Record<string, IndexDescription[]> = {
  users: [{ key: { email: 1 }, name: "email_unique", unique: true }],
  refreshTokens: [
    { key: { token: 1 }, name: "token" }, { key: { userId: 1 }, name: "userId" },
    { key: { expiresAt: 1 }, name: "expiresAt_ttl", expireAfterSeconds: 0 },
  ],
  trips: [{ key: { inviteCode: 1 }, name: "inviteCode_unique", unique: true }, { key: { visibility: 1 }, name: "visibility" }],
  tripMembers: [{ key: { tripId: 1, userId: 1 }, name: "tripId_userId_unique", unique: true }, { key: { userId: 1 }, name: "userId" }],
  destinations: [{ key: { tripId: 1, order: 1 }, name: "tripId_order", unique: true }],
  transports: [
    { key: { tripId: 1 }, name: "tripId" }, { key: { destinationId: 1 }, name: "destinationId" },
    { key: { destinationId: 1, direction: 1 }, name: "destinationId_direction_unique", unique: true },
  ],
  itineraryDays: [
    { key: { tripId: 1, order: 1 }, name: "tripId_order" },
    { key: { tripId: 1, destinationId: 1, date: 1, type: 1 }, name: "itinerary_identity_unique", unique: true },
  ],
  activities: [{ key: { tripId: 1 }, name: "tripId" }, { key: { dayId: 1 }, name: "dayId" }],
  activityParticipations: [{ key: { activityId: 1, userId: 1 }, name: "activityId_userId_unique", unique: true }],
  activityVotes: [{ key: { activityId: 1, userId: 1 }, name: "activityId_userId_unique", unique: true }],
  posts: [
    { key: { tripId: 1 }, name: "tripId" }, { key: { dayId: 1 }, name: "dayId" },
    { key: { activityId: 1 }, name: "activityId" }, { key: { parentPostId: 1 }, name: "parentPostId" },
    { key: { transportId: 1 }, name: "transportId" },
  ],
  postPhotos: [{ key: { postId: 1 }, name: "postId" }],
  postExpenses: [{ key: { postId: 1 }, name: "postId_unique", unique: true }],
  postLikes: [{ key: { postId: 1, userId: 1 }, name: "postId_userId_unique", unique: true }],
  comments: [{ key: { postId: 1, createdAt: 1 }, name: "postId_createdAt" }],
  commentLikes: [{ key: { commentId: 1, userId: 1 }, name: "commentId_userId_unique", unique: true }],
};

const id = (value: number) => new ObjectId(value.toString(16).padStart(24, "0"));
export const legacyIds = {
  trip: id(1), otherTrip: id(2), user: id(3), formerUser: id(4), destination: id(5),
  day: id(6), otherDay: id(7), missingDay: id(8), activity: id(9), transport: id(10),
  root: id(11), child: id(12), branch: id(13), multipleLinks: id(14),
  orphanDayPost: id(15), foreignDayPost: id(16), independent: id(17),
  legacyExpense: id(18), completeExpense: id(19), nullPayerExpense: id(20),
};
const publishedAt = () => new Date("2026-10-03T12:00:00.789Z");

export const legacyContractDocuments = (): Record<string, Document[]> => {
  const i = legacyIds;
  const post = (postId: ObjectId, links: Document = {}) => ({
    _id: postId, tripId: i.trip, authorId: i.user, description: "Recuerdo", mapsUrl: null,
    activityId: null, parentPostId: null, transportId: null, createdAt: publishedAt(), ...links,
  });
  return {
    users: [{ _id: i.user, email: "current@example.test" }, { _id: i.formerUser, email: "former@example.test" }],
    trips: [{ _id: i.trip, inviteCode: "LEGACY", expenseMode: "register" }, { _id: i.otherTrip, inviteCode: "OTHER" }],
    tripMembers: [{ tripId: i.trip, userId: i.user, role: "participant" }],
    destinations: [{ _id: i.destination, tripId: i.trip, order: 1 }],
    transports: [{ _id: i.transport, tripId: i.trip, destinationId: i.destination, direction: "outbound" }],
    itineraryDays: [
      { _id: i.day, tripId: i.trip, destinationId: i.destination, date: new Date("2026-09-25T00:00:00Z"), type: "activity", order: 1 },
      { _id: i.otherDay, tripId: i.otherTrip, destinationId: i.destination, date: new Date("2026-09-25T00:00:00Z"), type: "activity", order: 1 },
    ],
    activities: [{ _id: i.activity, tripId: i.trip, dayId: i.day, scheduledAt: new Date("2026-09-25T12:00:00.456Z") }],
    activityParticipations: [{ tripId: i.trip, activityId: i.activity, userId: i.user, status: "going" }],
    activityVotes: [{ tripId: i.trip, activityId: i.activity, userId: i.user, value: "yes" }],
    posts: [
      post(i.root, { activityId: i.activity, dayId: i.day }),
      post(i.child, { parentPostId: i.root }), post(i.branch, { parentPostId: i.root }),
      post(i.multipleLinks, { activityId: i.activity, parentPostId: i.root, transportId: i.transport }),
      post(i.orphanDayPost, { dayId: i.missingDay }), post(i.foreignDayPost, { dayId: i.otherDay }),
      post(i.independent),
    ],
    postExpenses: [
      { _id: i.legacyExpense, tripId: i.trip, postId: i.root, totalAmount: 42.5, breakdown: "Entrada", paidBy: i.formerUser, createdAt: publishedAt() },
      { _id: i.completeExpense, tripId: i.trip, postId: i.child, totalAmount: 100, currency: "ARS", payments: [{ userId: i.user, unit: "amount", value: 100 }], shares: [{ userId: i.user, unit: "percent", value: 100 }], createdAt: publishedAt() },
      { _id: i.nullPayerExpense, tripId: i.trip, postId: i.branch, totalAmount: 20, paidBy: null, createdAt: publishedAt() },
    ],
    postPhotos: [{ postId: i.root, tripId: i.trip, s3Key: "legacy/photo.jpg", order: 0 }],
    postLikes: [{ tripId: i.trip, postId: i.root, userId: i.user }],
    comments: [{ _id: id(21), tripId: i.trip, postId: i.root, text: "Comentario", createdAt: publishedAt() }],
    commentLikes: [{ tripId: i.trip, commentId: id(21), userId: i.user }],
  };
};

// Call only with a Db owned by MongoMemoryServer. Never loads environment config or resets data.
export const seedVersion3Fixture = async (database: Db): Promise<void> => {
  for (const [name, indexes] of Object.entries(version3Indexes)) {
    await database.createCollection(name);
    await database.collection(name).createIndexes(indexes);
  }
  await database.collection("_migrations").createIndex({ id: 1 }, { name: "id_unique", unique: true });
  await database.collection("_migrations").insertMany([
    "0001-create-prd-schema", "0002-unique-journey-order-and-direction", "0003-unique-itinerary-identity",
  ].map((migrationId) => ({ id: migrationId, appliedAt: new Date("2026-10-01T00:00:00.123Z") })));
  for (const [name, documents] of Object.entries(legacyContractDocuments())) {
    await database.collection(name).insertMany(documents);
  }
};

export const snapshotDocuments = async (database: Db): Promise<Record<string, Document[]>> => {
  const snapshot: Record<string, Document[]> = {};
  for (const { name } of await database.listCollections({}, { nameOnly: true }).toArray()) {
    snapshot[name] = await database.collection(name).find().sort({ _id: 1 }).toArray();
  }
  return snapshot;
};
