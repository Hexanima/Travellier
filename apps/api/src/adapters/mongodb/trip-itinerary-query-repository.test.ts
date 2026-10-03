import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createObjectId } from "app-domain";
import { createTripApi } from "../../trips/trip-api.js";
import { migrateMongoSchema } from "./migrations.js";

const domainId = (value: ObjectId) => {
  const result = createObjectId(value.toHexString());
  if (!result.ok) throw result.error;
  return result.value;
};
describe("Mongo itinerary query", () => {
  let server: MongoMemoryReplSet, client: MongoClient, db: Db;
  let trip: ObjectId, actor: ObjectId, destination: ObjectId, day: ObjectId, activity: ObjectId, post: ObjectId, transport: ObjectId;
  const departure = new Date("2026-09-25T08:00:00.123Z"), arrival = new Date("2026-09-25T10:00:00.456Z");
  const commands: string[] = [];
  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = new MongoClient(server.getUri(), { monitorCommands: true });
    client.on("commandStarted", (event) => commands.push(event.commandName));
    await client.connect(); db = client.db("itinerary_read"); await migrateMongoSchema(db);
  }, 120_000);
  afterAll(async () => { await client?.close(); await server?.stop(); });
  beforeEach(async () => {
    vi.restoreAllMocks();
    for (const name of ["trips", "tripMembers", "destinations", "itineraryDays", "transports", "activities", "posts", "postExpenses"]) await db.collection(name).deleteMany({});
    trip = new ObjectId(); actor = new ObjectId(); destination = new ObjectId(); day = new ObjectId();
    activity = new ObjectId(); post = new ObjectId(); transport = new ObjectId();
    await db.collection("trips").insertOne({ _id: trip, expenseMode: "register", votingEnabled: false, visibility: "public", inviteCode: trip.toHexString(), destinationOrderRevision: 12 });
    await db.collection("tripMembers").insertOne({ tripId: trip, userId: actor, role: "participant", joinedAt: departure });
    await db.collection("destinations").insertOne({ _id: destination, tripId: trip, name: "Córdoba", order: 1, createdAt: departure });
    await db.collection("itineraryDays").insertOne({ _id: day, tripId: trip, destinationId: destination, date: new Date("2026-09-25T00:00:00Z"), type: "activity", startsAt: arrival, endsAt: null, order: 1 });
    await db.collection("transports").insertOne({ _id: transport, tripId: trip, destinationId: destination, direction: "outbound", type: "car",
      departurePlace: "Origen", arrivalPlace: "Córdoba", departureAt: departure, arrivalAt: arrival, costPerPerson: null, details: {} });
    await db.collection("activities").insertOne({ _id: activity, tripId: trip, dayId: day, title: "Paseo", description: null,
      scheduledAt: new Date("2026-09-25T12:00:00.789Z"), mapsUrl: null, status: "confirmed", createdBy: actor, createdAt: arrival });
    await db.collection("posts").insertOne({ _id: post, tripId: trip, dayId: day, authorId: actor, description: null, mapsUrl: null,
      activityId: activity, transportId: transport, parentPostId: null, createdAt: arrival });
    await db.collection("postExpenses").insertOne({ tripId: trip, postId: post, totalAmount: 42.5, breakdown: null, paidBy: actor, createdAt: arrival });
  });
  const query = async (user = actor, target = trip) => {
    const api = createTripApi(db);
    expect(api.getItinerary, "aggregate read is composed into the Trip API").toBeDefined();
    return api.getItinerary!({ tripId: domainId(target), authenticatedUserId: domainId(user) });
  };

  it("maps BSON references, UTC precision, nulls and the expense into one aggregate", async () => {
    expect(await query()).toMatchObject({ ok: true, value: { tripId: trip.toHexString(), expenseMode: "register", votingEnabled: false,
      destinations: [{ id: destination.toHexString(), name: "Córdoba" }],
      activities: [{ id: activity.toHexString(), scheduledAt: new Date("2026-09-25T12:00:00.789Z"), postIds: [post.toHexString()] }],
      transports: [{ id: transport.toHexString(), departureAt: departure, postIds: [post.toHexString()] }],
      days: [{ id: day.toHexString(), endsAt: null, expenseSummary: { totalAmount: 42.5, expenseCount: 1 } }],
      posts: [{ id: post.toHexString(), authorId: actor.toHexString(), activityId: activity.toHexString(), transportId: transport.toHexString(), parentPostId: null,
        expense: { totalAmount: 42.5, paidBy: actor.toHexString() } }] } });
  });

  it("restricts public Trip content to members and returns missing Trips as not found", async () => {
    expect(await query(new ObjectId())).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    await db.collection("trips").deleteOne({ _id: trip });
    expect(await query()).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
  });

  it("excludes foreign documents, cross-Trip links and orphan expenses", async () => {
    const foreignTrip = new ObjectId(), foreignActivity = new ObjectId(), foreignPost = new ObjectId();
    const record = await db.collection("activities").findOne({ _id: activity });
    await db.collection("activities").insertOne({ ...record!, _id: foreignActivity, tripId: foreignTrip });
    await db.collection("posts").updateOne({ _id: post }, { $set: { activityId: foreignActivity, parentPostId: foreignPost } });
    await db.collection("posts").insertOne({ ...await db.collection("posts").findOne({ _id: post }), _id: foreignPost, tripId: foreignTrip });
    await db.collection("postExpenses").updateOne({ postId: post }, { $set: { tripId: foreignTrip } });
    await db.collection("postExpenses").insertOne({ postId: new ObjectId(), tripId: trip, totalAmount: 900 });
    const result = await query();
    expect(result).toMatchObject({ ok: true, value: { activities: [{ id: activity.toHexString() }],
      posts: [{ id: post.toHexString(), activityId: null, parentPostId: null, expense: null }], days: [{ expenseSummary: { totalAmount: 0, expenseCount: 0 } }] } });
  });

  it("uses a bounded number of queries as the number of days grows and does not write", async () => {
    commands.length = 0; expect((await query()).ok).toBe(true);
    const first = commands.filter((name) => name === "find" || name === "aggregate").length;
    expect(commands.some((name) => ["update", "insert", "delete", "findAndModify"].includes(name))).toBe(false);
    for (let index = 1; index <= 10; index++) {
      await db.collection("itineraryDays").insertOne({ _id: new ObjectId(), tripId: trip, destinationId: destination,
        date: new Date(Date.UTC(2026, 8, 25 + index)), type: "activity", startsAt: arrival, endsAt: null, order: index + 1 });
    }
    commands.length = 0; const result = await query();
    expect(result.ok && result.value.days.length).toBe(11);
    expect(commands.filter((name) => name === "find" || name === "aggregate").length).toBe(first);
    expect(commands.some((name) => ["update", "insert", "delete", "findAndModify"].includes(name))).toBe(false);
    expect(await db.collection("trips").findOne({ _id: trip })).toMatchObject({ destinationOrderRevision: 12 });
  });

  it("reads transports and days from the same snapshot during a committed mutation", async () => {
    const days = db.collection("itineraryDays"), realCollection = db.collection.bind(db), realFind = days.find.bind(days);
    let changed = false;
    vi.spyOn(db, "collection").mockImplementation(((name: string) => name === "itineraryDays" ? days : realCollection(name)) as typeof db.collection);
    vi.spyOn(days, "find").mockImplementation((...args: Parameters<typeof days.find>) => {
      const cursor = realFind(...args), read = cursor.toArray.bind(cursor);
      vi.spyOn(cursor, "toArray").mockImplementation(async () => {
        const result = await read();
        if (!changed) {
          changed = true;
          const writer = client.startSession();
          try {
            await writer.withTransaction(async () => {
              const next = new Date("2026-09-25T11:00:00.456Z");
              await realCollection("transports").updateOne({ _id: transport }, { $set: { arrivalAt: next } }, { session: writer });
              await realCollection("itineraryDays").updateOne({ _id: day }, { $set: { startsAt: next } }, { session: writer });
            });
          } finally { await writer.endSession(); }
        }
        return result;
      });
      return cursor;
    });
    const result = await query();
    expect(changed).toBe(true);
    expect(result).toMatchObject({ ok: true, value: { days: [{ startsAt: arrival }], transports: [{ arrivalAt: arrival }] } });
    vi.restoreAllMocks();
    expect(await query()).toMatchObject({ ok: true, value: { days: [{ startsAt: new Date("2026-09-25T11:00:00.456Z") }],
      transports: [{ arrivalAt: new Date("2026-09-25T11:00:00.456Z") }] } });
  });

  it("returns an error on a failed read instead of partial content", async () => {
    const real = db.collection.bind(db);
    vi.spyOn(db, "collection").mockImplementation(((name: string) => { if (name === "posts") throw new Error("injected read failure"); return real(name); }) as typeof db.collection);
    expect(await query()).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
  });
});
