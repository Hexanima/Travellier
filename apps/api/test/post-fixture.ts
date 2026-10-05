import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createObjectId } from "app-domain";
import { migrateMongoSchema } from "../src/adapters/mongodb/migrations.js";
import { handleApiRequest, type TripApi } from "../src/app.js";
import { createTripApi } from "../src/trips/trip-api.js";

export const domainId = (value: ObjectId) => {
  const parsed = createObjectId(value.toHexString());
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};

export class PostFixture {
  server!: MongoMemoryReplSet;
  client!: MongoClient;
  db!: Db;
  api!: TripApi;
  trip!: ObjectId;
  actor!: ObjectId;
  destination!: ObjectId;
  day!: ObjectId;
  occurrence = new Date("2026-09-25T12:00:00.456Z");
  async start(name: string) {
    this.server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    this.client = new MongoClient(this.server.getUri()); await this.client.connect();
    this.db = this.client.db(name); await migrateMongoSchema(this.db);
  }
  async stop() { await this.client?.close(); await this.server?.stop(); }
  async reset() {
    for (const name of ["trips", "tripMembers", "destinations", "itineraryDays", "activities", "transports", "posts",
      "postPhotos", "postExpenses", "comments", "postLikes", "commentLikes", "activityVotes", "activityParticipations"])
      await this.db.collection(name).deleteMany({});
    this.trip = new ObjectId(); this.actor = new ObjectId(); this.destination = new ObjectId(); this.day = new ObjectId();
    await this.db.collection("trips").insertOne({ _id: this.trip, inviteCode: this.trip.toHexString(), visibility: "public", votingEnabled: false, expenseMode: "register" });
    await this.db.collection("tripMembers").insertOne({ tripId: this.trip, userId: this.actor, role: "participant", joinedAt: new Date() });
    await this.db.collection("destinations").insertOne({ _id: this.destination, tripId: this.trip, name: "Córdoba", order: 1, createdAt: new Date() });
    await this.db.collection("itineraryDays").insertOne({ _id: this.day, tripId: this.trip, destinationId: this.destination, type: "activity", order: 1,
      date: new Date("2026-09-25T00:00:00Z"), startsAt: new Date("2026-09-25T10:00:00.123Z"), endsAt: new Date("2026-09-25T18:00:00.789Z") });
    this.api = createTripApi(this.db);
  }
  context() { return { tripId: domainId(this.trip), authenticatedUserId: domainId(this.actor) }; }
  input() { return { ...this.context(), dayId: domainId(this.day), description: "Recuerdo" }; }
  path() { return `/trips/${this.trip}/posts`; }
  request(method: string, url = this.path(), body?: unknown, user = this.actor) {
    return handleApiRequest({ method, url, body, authenticatedUserId: domainId(user) }, { trips: this.api });
  }
  async snapshot() {
    return Promise.all(["trips", "posts", "activities"].map((name) => this.db.collection(name).find().sort({ _id: 1 }).toArray()));
  }
  async configureTransports() {
    const base = { ...this.context(), destinationId: domainId(this.destination), type: "car" as const,
      departurePlace: "Origen", arrivalPlace: "Destino", costPerPerson: null, details: {} };
    const outbound = await this.api.createTransport!({ ...base, direction: "outbound", departureAt: new Date("2026-09-25T08:00:00Z"), arrivalAt: new Date("2026-09-25T10:00:00.123Z") });
    const returning = await this.api.createTransport!({ ...base, direction: "return", departureAt: new Date("2026-09-25T18:00:00.789Z"), arrivalAt: new Date("2026-09-25T20:00:00Z") });
    if (!outbound.ok) throw outbound.error;
    if (!returning.ok) throw returning.error;
    this.day = (await this.db.collection("itineraryDays").findOne({ tripId: this.trip, type: "activity" }))!._id;
    return outbound.value;
  }
}
