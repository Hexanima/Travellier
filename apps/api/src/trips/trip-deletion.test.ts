import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { randomUUID } from "node:crypto";
import { createObjectId, createPhotoUploadKey, err, UnknownError } from "app-domain";
import { FakeObjectStorage } from "../../test/fake-object-storage.js";
import { handleApiRequest } from "../app.js";
import { migrateMongoSchema } from "../adapters/mongodb/migrations.js";
import { createTripApi } from "./trip-api.js";
import { createMongoTripDeletionRepository } from "../adapters/mongodb/trip-deletion-repository.js";

const domainId = (id: ObjectId) => {
  const result = createObjectId(id.toHexString());
  if (!result.ok) throw result.error;
  return result.value;
};

describe("Trip deletion HTTP and MongoDB integration", () => {
  let server: MongoMemoryReplSet;
  let client: MongoClient;
  let database: Db;
  let tripId: ObjectId;
  let userId: ObjectId;
  let firstId: ObjectId;
  let secondId: ObjectId;

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = new MongoClient(server.getUri());
    await client.connect();
    database = client.db("trip_deletion_test");
    await migrateMongoSchema(database);
  }, 120_000);
  afterAll(async () => { await client?.close(); await server?.stop(); });
  beforeEach(async () => {
    for (const collection of await database.collections()) await collection.deleteMany({});
    tripId = new ObjectId(); userId = new ObjectId(); firstId = new ObjectId(); secondId = new ObjectId();
    await database.collection("trips").insertOne({ _id: tripId, inviteCode: "VIAJE-TEST" });
    await database.collection("tripMembers").insertOne({ tripId, userId, role: "participant", joinedAt: new Date() });
    await database.collection("destinations").insertMany([
      { _id: firstId, tripId, name: "Primero", order: 1, createdAt: new Date() },
      { _id: secondId, tripId, name: "Segundo", order: 2, createdAt: new Date() },
    ]);
  });

  const request = (destinationId: ObjectId, actor: ObjectId | undefined = userId, trip = tripId) =>
    handleApiRequest({ method: "DELETE", url: `/trips/${trip}/destinations/${destinationId}`,
      authenticatedUserId: actor === undefined ? undefined : domainId(actor) }, { trips: createTripApi(database) });

  const deleteTripRequest = (actor: ObjectId = userId, trip = tripId) => handleApiRequest({ method: "DELETE",
    url: `/trips/${trip}`, authenticatedUserId: domainId(actor) }, { trips: createTripApi(database) });

  const tripCollections = ["tripMembers", "destinations", "transports", "itineraryDays", "activities",
    "activityParticipations", "activityVotes", "posts", "postPhotos", "postExpenses", "postLikes", "comments", "commentLikes", "outboxEvents"];

  it.each(["transports", "itineraryDays", "activities", "posts"])("reports destination records from %s for hiding deletion", async (collection) => {
    await database.collection(collection).insertOne({ tripId, destinationId: firstId });
    await database.collection(collection).insertOne({ tripId: new ObjectId(), destinationId: secondId });
    const response = await handleApiRequest({ method: "GET", url: `/trips/${tripId}/destinations`,
      authenticatedUserId: domainId(userId) }, { trips: createTripApi(database) });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).destinations).toMatchObject([
      { id: firstId.toHexString(), hasRecords: true }, { id: secondId.toHexString(), hasRecords: false },
    ]);
  });

  it("allows an admin to delete the group with members and all associated records, without affecting another group or users", async () => {
    await database.collection("tripMembers").updateOne({ tripId, userId }, { $set: { role: "admin" } });
    await database.collection("tripMembers").insertOne({ tripId, userId: new ObjectId(), role: "participant" });
    const otherTripId = new ObjectId();
    await database.collection("trips").insertOne({ _id: otherTripId, inviteCode: "VIAJE-KEEP" });
    await database.collection("users").insertOne({ _id: userId, email: "admin@example.test" });
    await database.collection("refreshTokens").insertOne({ userId, token: "keep-session" });
    for (const name of tripCollections) {
      const fields = () => ({ userId: new ObjectId(), destinationId: new ObjectId(), direction: "outbound",
        activityId: new ObjectId(), postId: new ObjectId(), commentId: new ObjectId(), date: new Date(), type: "activity", order: 1,
        s3Key: `trips/seed/${new ObjectId().toHexString()}.jpg`, eventKey: new ObjectId().toHexString() });
      if (name !== "destinations" && name !== "tripMembers") await database.collection(name).insertOne({ tripId, ...fields() });
      await database.collection(name).insertOne({ tripId: otherTripId, ...fields() });
    }
    expect((await deleteTripRequest()).statusCode).toBe(204);
    expect(await database.collection("trips").findOne({ _id: tripId })).toBeNull();
    for (const name of tripCollections) {
      expect(await database.collection(name).countDocuments({ tripId }), name).toBe(name === "activityVotes" ? 1 : 0);
      expect(await database.collection(name).countDocuments({ tripId: otherTripId }), name).toBe(1);
    }
    expect(await database.collection("trips").findOne({ _id: otherTripId })).not.toBeNull();
    expect(await database.collection("users").findOne({ _id: userId })).not.toBeNull();
    expect(await database.collection("refreshTokens").countDocuments({ userId })).toBe(1);
  });

  it("deletes only the real comments of the deleted Trip, created through the comments API", async () => {
    await database.collection("tripMembers").updateOne({ tripId, userId }, { $set: { role: "admin" } });
    const otherTripId = new ObjectId(), otherUser = new ObjectId();
    await database.collection("trips").insertOne({ _id: otherTripId, inviteCode: "VIAJE-OTHER" });
    await database.collection("tripMembers").insertOne({ tripId: otherTripId, userId: otherUser, role: "participant", joinedAt: new Date() });
    const api = createTripApi(database), seeded: Record<string, string> = {};
    for (const [trip, user] of [[tripId, userId], [otherTripId, otherUser]] as const) {
      const post = await api.createPost!({ tripId: domainId(trip), authenticatedUserId: domainId(user), description: "Recuerdo" });
      if (!post.ok || post.value.outcome !== "created") throw new Error("Post not created.");
      const comment = await api.createComment!({ tripId: domainId(trip), authenticatedUserId: domainId(user), postId: post.value.post.id, text: "Hola" });
      if (!comment.ok) throw comment.error;
      seeded[trip.toHexString()] = comment.value.id;
    }
    expect(await database.collection("comments").countDocuments({})).toBe(2);
    expect((await deleteTripRequest()).statusCode).toBe(204);
    expect(await database.collection("comments").countDocuments({ tripId })).toBe(0);
    const remaining = await database.collection("comments").find({}).toArray();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!._id.toHexString()).toBe(seeded[otherTripId.toHexString()]);
    expect(remaining[0]!.tripId).toEqual(otherTripId);
  });

  it("deletes the real events and personal notices of the deleted Trip only (T91)", async () => {
    await database.collection("tripMembers").updateOne({ tripId, userId }, { $set: { role: "admin" } });
    const otherTripId = new ObjectId(), otherUser = new ObjectId(), peer = new ObjectId(), otherPeer = new ObjectId();
    await database.collection("trips").insertOne({ _id: otherTripId, inviteCode: "VIAJE-OTHER" });
    await database.collection("tripMembers").insertMany([{ tripId, userId: peer, role: "participant", joinedAt: new Date() },
      { tripId: otherTripId, userId: otherUser, role: "participant", joinedAt: new Date() }, { tripId: otherTripId, userId: otherPeer, role: "participant", joinedAt: new Date() }]);
    const api = createTripApi(database);
    for (const [trip, user] of [[tripId, userId], [otherTripId, otherUser]] as const) {
      const post = await api.createPost!({ tripId: domainId(trip), authenticatedUserId: domainId(user), description: "Recuerdo" });
      if (!post.ok) throw post.error;
    }
    expect(await database.collection("outboxEvents").countDocuments({ tripId })).toBe(1);
    expect(await database.collection("outboxEvents").countDocuments({ tripId: otherTripId })).toBe(1);
    expect((await deleteTripRequest()).statusCode).toBe(204);
    expect(await database.collection("outboxEvents").countDocuments({ tripId })).toBe(0);
    expect(await database.collection("outboxEvents").countDocuments({ tripId: otherTripId })).toBe(1);
  });

  it("deletes only the real likes of the deleted Trip, created through the likes API", async () => {
    await database.collection("tripMembers").updateOne({ tripId, userId }, { $set: { role: "admin" } });
    const otherTripId = new ObjectId(), otherUser = new ObjectId();
    await database.collection("trips").insertOne({ _id: otherTripId, inviteCode: "VIAJE-OTHER" });
    await database.collection("tripMembers").insertOne({ tripId: otherTripId, userId: otherUser, role: "participant", joinedAt: new Date() });
    const api = createTripApi(database);
    for (const [trip, user] of [[tripId, userId], [otherTripId, otherUser]] as const) {
      const post = await api.createPost!({ tripId: domainId(trip), authenticatedUserId: domainId(user), description: "Recuerdo" });
      if (!post.ok || post.value.outcome !== "created") throw new Error("Post not created.");
      const context = { tripId: domainId(trip), authenticatedUserId: domainId(user), postId: post.value.post.id };
      const comment = await api.createComment!({ ...context, text: "Hola" });
      if (!comment.ok) throw comment.error;
      expect((await api.likePost!(context)).ok).toBe(true);
      expect((await api.likeComment!({ ...context, commentId: comment.value.id })).ok).toBe(true);
    }
    expect(await database.collection("postLikes").countDocuments({})).toBe(2);
    expect(await database.collection("commentLikes").countDocuments({})).toBe(2);
    expect((await deleteTripRequest()).statusCode).toBe(204);
    for (const name of ["postLikes", "commentLikes"]) {
      expect(await database.collection(name).countDocuments({ tripId }), name).toBe(0);
      expect(await database.collection(name).find({}).toArray(), name).toMatchObject([{ tripId: otherTripId, userId: otherUser }]);
    }
  });

  it("does not allow a participant or an outsider to delete the group", async () => {
    expect((await deleteTripRequest()).statusCode).toBe(403);
    expect((await deleteTripRequest(new ObjectId())).statusCode).toBe(404);
    await database.collection("trips").updateOne({ _id: tripId }, { $set: { visibility: "public" } });
    expect((await deleteTripRequest(new ObjectId())).statusCode).toBe(404);
    expect(await database.collection("destinations").countDocuments({ tripId })).toBe(2);
    expect(await database.collection("trips").findOne({ _id: tripId })).not.toBeNull();
  });

  it("requires authentication and a valid Trip identifier for group deletion", async () => {
    const trips = createTripApi(database);
    expect((await handleApiRequest({ method: "DELETE", url: `/trips/${tripId}` }, { trips })).statusCode).toBe(401);
    expect((await handleApiRequest({ method: "DELETE", url: "/trips/invalid", authenticatedUserId: domainId(userId) }, { trips })).statusCode).toBe(400);
    expect((await deleteTripRequest(userId, new ObjectId())).statusCode).toBe(404);
  });

  it("serializes concurrent group deletions and invalidates its invitation", async () => {
    await database.collection("tripMembers").updateOne({ tripId, userId }, { $set: { role: "admin" } });
    expect((await Promise.all([deleteTripRequest(), deleteTripRequest()])).map((response) => response.statusCode).sort()).toEqual([204, 404]);
    const joined = await createTripApi(database).joinByCode({ authenticatedUserId: domainId(new ObjectId()), code: "VIAJE-TEST" });
    expect(joined).toMatchObject({ ok: false, error: { tag: "InvalidInviteCodeError" } });
    expect(await database.collection("tripMembers").countDocuments({ tripId })).toBe(0);
  });

  it("retains S3 cleanup keys durably without blocking group deletion", async () => {
    await database.collection("tripMembers").updateOne({ tripId, userId }, { $set: { role: "admin" } });
    await database.collection("postPhotos").insertMany([
      { tripId, postId: new ObjectId(), order: 1, s3Key: "trips/test/photo.jpg" },
      { tripId, postId: new ObjectId(), order: 1, s3Key: "trips/test/photo-2.jpg" },
      { tripId: new ObjectId(), postId: new ObjectId(), order: 1, s3Key: "trips/other/keep.jpg" },
    ]);
    expect((await deleteTripRequest()).statusCode).toBe(204);
    expect(await database.collection("storageDeletionJobs").find({ tripId }).toArray()).toMatchObject([
      { objectKeys: ["trips/test/photo.jpg", "trips/test/photo-2.jpg"], createdAt: expect.any(Date), status: "pending", attempts: 0,
        resolvedKeys: [], rejectedKeys: [], nextAttemptAt: expect.any(Date) },
    ]);
    expect(await database.collection("postPhotos").countDocuments({ tripId })).toBe(0);
    expect(await database.collection("postPhotos").countDocuments({ s3Key: "trips/other/keep.jpg" })).toBe(1);
  });

  it("keeps a cleanup job with the S3 keys of photos registered through the upload protocol", async () => {
    await database.collection("tripMembers").updateOne({ tripId, userId }, { $set: { role: "admin" } });
    const storage = new FakeObjectStorage(), api = createTripApi(database, { storage });
    const keys = ["jpg", "png"].map((extension) => createPhotoUploadKey({ tripId: domainId(tripId), userId: domainId(userId),
      uploadId: randomUUID(), extension: extension as "jpg" | "png" }));
    storage.put(keys[0]!, "image/jpeg"); storage.put(keys[1]!, "image/png");
    const post = await api.createPost!({ tripId: domainId(tripId), authenticatedUserId: domainId(userId), photos: keys.map((key) => ({ key })) });
    expect(post).toMatchObject({ ok: true, value: { photos: [{ order: 1 }, { order: 2 }] } });
    expect(await database.collection("postPhotos").countDocuments({ tripId })).toBe(2);
    expect((await deleteTripRequest()).statusCode).toBe(204);
    const jobs = await database.collection("storageDeletionJobs").find({ tripId }).toArray();
    expect(jobs).toHaveLength(1);
    expect([...jobs[0]!.objectKeys].sort()).toEqual([...keys].sort());
    expect(await database.collection("postPhotos").countDocuments({ tripId })).toBe(0);
  });

  it("rolls back the complete cascade when its transaction returns an error", async () => {
    await database.collection("postPhotos").insertOne({ tripId, s3Key: "trips/test/photo.jpg" });
    let removalSucceeded = false;
    const result = await createMongoTripDeletionRepository(database).withTransaction(domainId(tripId), async (scope) => {
      const deleted = await scope.removeTrip();
      removalSucceeded = deleted.ok;
      return err(new UnknownError("Abort after deletion."));
    });
    expect(removalSucceeded).toBe(true);
    expect(result.ok).toBe(false);
    expect(await database.collection("trips").findOne({ _id: tripId })).not.toBeNull();
    expect(await database.collection("tripMembers").countDocuments({ tripId })).toBe(1);
    expect(await database.collection("destinations").countDocuments({ tripId })).toBe(2);
    expect(await database.collection("postPhotos").countDocuments({ tripId })).toBe(1);
    expect(await database.collection("storageDeletionJobs").countDocuments({ tripId })).toBe(0);
  });

  it("allows members to delete an empty destination and compacts the order", async () => {
    expect((await request(firstId)).statusCode).toBe(204);
    expect(await database.collection("destinations").find({ tripId }).toArray()).toMatchObject([
      { _id: secondId, order: 1, name: "Segundo" },
    ]);
  });

  it("rejects deleting the only remaining destination without changing anything", async () => {
    await database.collection("destinations").deleteOne({ _id: secondId });
    const response = await request(firstId);
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toMatchObject({ error: { code: "LastDestinationError" } });
    expect(await database.collection("destinations").countDocuments({ tripId })).toBe(1);
  });

  it.each(["transports", "itineraryDays", "activities", "posts"])("blocks deletion with %s associated to the destination", async (collection) => {
    await database.collection(collection).insertOne({ tripId, destinationId: firstId });
    const response = await request(firstId);
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toMatchObject({ error: { code: "DeletionConflictError" } });
    expect(await database.collection("destinations").countDocuments({ tripId })).toBe(2);
    expect(await database.collection(collection).countDocuments({ tripId })).toBe(1);
  });

  it("does not let records on another destination block an empty destination", async () => {
    await database.collection("transports").insertOne({ tripId, destinationId: firstId });
    expect((await request(secondId)).statusCode).toBe(204);
    expect(await database.collection("transports").countDocuments({ tripId })).toBe(1);
  });

  it("rejects nonmembers and cross-Trip destinations without leaking records", async () => {
    expect((await request(firstId, new ObjectId())).statusCode).toBe(404);
    const otherTrip = new ObjectId();
    await database.collection("trips").insertOne({ _id: otherTrip, inviteCode: "VIAJE-OTHER" });
    await database.collection("tripMembers").insertOne({ tripId: otherTrip, userId, role: "participant" });
    expect((await request(firstId, userId, otherTrip)).statusCode).toBe(404);
    expect((await request(new ObjectId())).statusCode).toBe(404);
    expect(await database.collection("destinations").countDocuments({ tripId })).toBe(2);
  });

  it("requires authentication and validates identifiers", async () => {
    expect((await handleApiRequest({ method: "DELETE", url: `/trips/${tripId}/destinations/${firstId}` },
      { trips: createTripApi(database) })).statusCode).toBe(401);
    expect((await handleApiRequest({ method: "DELETE", url: `/trips/${tripId}/destinations/invalid`,
      authenticatedUserId: domainId(userId) }, { trips: createTripApi(database) })).statusCode).toBe(400);
  });

  it("serializes simultaneous deletions so at least one destination survives", async () => {
    const responses = await Promise.all([request(firstId), request(secondId)]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([204, 409]);
    expect(await database.collection("destinations").find({ tripId }).toArray()).toMatchObject([{ order: 1 }]);
  });
});
