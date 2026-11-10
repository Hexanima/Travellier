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
    await db.collection("postExpenses").insertOne({ tripId: trip, postId: post, totalAmount: 42.5, currency: "EUR", breakdown: null, paidBy: actor, createdAt: arrival });
  });
  const query = async (user = actor, target = trip) => {
    const api = createTripApi(db);
    expect(api.getItinerary, "aggregate read is composed into the Trip API").toBeDefined();
    return api.getItinerary!({ tripId: domainId(target), authenticatedUserId: domainId(user) });
  };

  it("maps BSON references, UTC precision, nulls and the expense into one aggregate", async () => {
    expect(await query()).toMatchObject({ ok: true, value: { tripId: trip.toHexString(), expenseMode: "register",
      destinations: [{ id: destination.toHexString(), name: "Córdoba" }],
      activities: [{ id: activity.toHexString(), scheduledAt: new Date("2026-09-25T12:00:00.789Z"), postIds: [post.toHexString()] }],
      transports: [{ id: transport.toHexString(), departureAt: departure, postIds: [post.toHexString()] }],
      days: [{ id: day.toHexString(), endsAt: null, expenseSummary: { byCurrency: [{ currency: "EUR", totalCents: 4250, expenseCount: 1 }], withoutCurrency: { expenseCount: 0 }, expenseCount: 1 } }],
      expenseSummary: { expenseCount: 1, outsideItinerary: { expenseCount: 0 } },
      expenses: [{ postId: post.toHexString(), rootActivityId: activity.toHexString(), source: "activity", currency: "EUR", amountCents: 4250,
        occurredAt: new Date("2026-09-25T12:00:00.789Z"), publishedAt: arrival, dayId: day.toHexString() }],
      posts: [{ id: post.toHexString(), authorId: actor.toHexString(), activityId: activity.toHexString(), transportId: transport.toHexString(), parentPostId: null,
        expense: { totalAmount: 42.5, currency: "EUR", paidBy: actor.toHexString() } }] } });
  });

  it("reads a legacy expense without currency as null (counted, never inferred) and tolerates a malformed legacy paidBy", async () => {
    await db.collection("postExpenses").updateOne({ postId: post }, { $unset: { currency: "" }, $set: { paidBy: [actor] } });
    const result = await query();
    expect(result).toMatchObject({ ok: true, value: { posts: [{ expense: { currency: null, paidBy: null, totalAmount: 42.5 } }],
      expenseSummary: { byCurrency: [], withoutCurrency: { expenseCount: 1 }, expenseCount: 1 }, expenses: [{ currency: null, amountCents: 4250 }] } });
    expect(await db.collection("postExpenses").findOne({ postId: post })).toMatchObject({ paidBy: [actor], totalAmount: 42.5 });
  });

  it("filters legacy arrival days from the aggregate without deleting them", async () => {
    const legacy = { _id: new ObjectId(), tripId: trip, destinationId: destination, date: new Date("2026-09-25T00:00:00Z"),
      type: "arrival", startsAt: arrival, endsAt: null, order: 0 };
    await db.collection("itineraryDays").insertOne(legacy);
    const result = await query();
    expect(result.ok && result.value.days.map((item) => item.id)).toEqual([day.toHexString()]);
    expect(await db.collection("itineraryDays").findOne({ _id: legacy._id })).toEqual(legacy);
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
      posts: [{ id: post.toHexString(), activityId: null, parentPostId: null, expense: null }], days: [{ expenseSummary: { byCurrency: [], expenseCount: 0 } }], expenses: [] } });
  });

  it("projects posts without a physical day by context and keeps late chains under their roots", async () => {
    const independent = new ObjectId(), child = new ObjectId(), grandchild = new ObjectId(), transportChild = new ObjectId(), transportGrandchild = new ObjectId();
    const base = { tripId: trip, authorId: actor, description: null, mapsUrl: null, activityId: null, transportId: null, parentPostId: null };
    await db.collection("posts").insertMany([
      { ...base, _id: independent, createdAt: new Date("2026-09-25T13:00:00.123Z") },
      { ...base, _id: child, parentPostId: post, createdAt: new Date("2026-10-05T13:00:00.001Z") },
      { ...base, _id: grandchild, parentPostId: child, createdAt: new Date("2026-10-06T13:00:00.002Z") },
      { ...base, _id: transportChild, parentPostId: post, transportId: null, createdAt: new Date("2026-10-07T13:00:00.003Z") },
      { ...base, _id: transportGrandchild, parentPostId: transportChild, createdAt: new Date("2026-10-08T13:00:00.004Z") },
    ]);
    await db.collection("posts").updateOne({ _id: post }, { $unset: { dayId: "" } });
    const result = await query();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.activities[0]!.postIds).toEqual([post, child, grandchild, transportChild, transportGrandchild].map((v) => v.toHexString()));
    expect(result.value.transports[0]!.postIds).toEqual(result.value.activities[0]!.postIds);
    expect(result.value.posts.find((p) => p.id === grandchild.toHexString())).toMatchObject({ dayId: day.toHexString(), parentPostId: child.toHexString(),
      createdAt: new Date("2026-10-06T13:00:00.002Z"), context: { rootPostId: post.toHexString(), rootActivityId: activity.toHexString(), placement: "activity" } });
    expect(result.value.days[0]!.items.filter((i) => i.kind === "post").map((i) => i.id)).toEqual([independent.toHexString()]);
    expect(result.value.unplacedPosts).toEqual([]);
  });

  it("projects a late chain rooted at a transport", async () => {
    const root = new ObjectId(), child = new ObjectId(), grandchild = new ObjectId();
    const base = { tripId: trip, authorId: actor, description: null, mapsUrl: null, activityId: null };
    await db.collection("posts").insertMany([
      { ...base, _id: root, transportId: transport, parentPostId: null, createdAt: new Date("2026-09-30T10:00:00.000Z") },
      { ...base, _id: child, transportId: null, parentPostId: root, createdAt: new Date("2026-10-01T10:00:00.000Z") },
      { ...base, _id: grandchild, transportId: null, parentPostId: child, createdAt: new Date("2026-10-02T10:00:00.000Z") },
    ]);
    const result = await query();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.transports[0]!.postIds).toEqual([post, root, child, grandchild].map((v) => v.toHexString()));
    expect(result.value.posts.find((p) => p.id === grandchild.toHexString())).toMatchObject({ context: { rootPostId: root.toHexString(),
      rootTransportId: transport.toHexString(), placement: "transport" } });
  });

  it("returns every post as unplaced in a Trip without itinerary, with one read of posts and one of expenses whatever the chain depth", async () => {
    for (const name of ["itineraryDays", "transports", "activities", "destinations"]) await db.collection(name).deleteMany({});
    const independent = new ObjectId(), deeper = [new ObjectId(), new ObjectId(), new ObjectId()];
    const link = (_id: ObjectId, parentPostId: ObjectId, hour: number) => ({ _id, tripId: trip, authorId: actor, description: "Libre", mapsUrl: null,
      activityId: null, transportId: null, parentPostId, createdAt: new Date(`2026-09-25T${hour}:00:00.123Z`) });
    // Four levels below the seeded root post: a lookup/aggregate per level would add reads and be detected below.
    await db.collection("posts").insertMany([link(independent, post, 13), link(deeper[0]!, independent, 14), link(deeper[1]!, deeper[0]!, 15), link(deeper[2]!, deeper[1]!, 16)]);
    await db.collection("postExpenses").insertOne({ tripId: trip, postId: independent, totalAmount: 3, breakdown: null, paidBy: actor, createdAt: arrival });
    const reads: string[] = [];
    const writes = ["insert", "update", "delete", "findAndModify"];
    const listener = (event: { commandName: string; command: Record<string, unknown> }) => {
      // Every command on the two collections counts (find, aggregate, count, distinct, getMore...), whatever its name.
      const target = String(event.command[event.commandName] ?? event.command.collection);
      if (["posts", "postExpenses"].includes(target) && !writes.includes(event.commandName)) reads.push(`${event.commandName}:${target}`);
    };
    client.on("commandStarted", listener);
    const result = await query();
    client.off("commandStarted", listener);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.posts).toEqual([]);
    expect(result.value.unplacedPosts.map((p) => p.id)).toEqual([post, independent, ...deeper].map((v) => v.toHexString()));
    expect(result.value.unplacedPosts[1]).toMatchObject({ dayId: null, parentPostId: post.toHexString(), createdAt: new Date("2026-09-25T13:00:00.123Z"), expense: { totalAmount: 3 } });
    expect(reads.sort()).toEqual(["find:postExpenses", "find:posts"]);
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
