import { ObjectId as MongoObjectId, type Db } from "mongodb";
import { createObjectId, err, ok, TaggedError, TripNotFoundError, UnknownError, type TripDeletionPort, type TripRole } from "app-domain";
import { createMongoTripJourneyRepository } from "./trip-journey-repository.js";

const destinationRecordCollections = ["transports", "itineraryDays", "activities", "posts"] as const;

export const createMongoTripDeletionRepository = (database: Db): TripDeletionPort => ({
  findDestinationIdsWithRecords: async (tripId) => {
    try {
      const ids = await Promise.all(destinationRecordCollections.map((name) => database.collection(name)
        .distinct("destinationId", { tripId: new MongoObjectId(tripId) })));
      const result = [...new Set(ids.flat().filter((id): id is MongoObjectId => id instanceof MongoObjectId)
        .map((id) => id.toHexString()))].map((id) => {
        const value = createObjectId(id);
        if (!value.ok) throw value.error;
        return value.value;
      });
      return ok(result);
    } catch { return err(new UnknownError("Destination record lookup failed.")); }
  },
  withTransaction: async (tripId, work) => {
    const session = database.client.startSession();
    const mongoTripId = new MongoObjectId(tripId);
    const options = { session };
    const destinations = database.collection("destinations");
    try {
      const result = await session.withTransaction(async () => {
        // Share the journey writer's Trip lock: checks and removal see one serialized state.
        const lock = await database.collection("trips").updateOne({ _id: mongoTripId },
          { $inc: { destinationOrderRevision: 1 } }, options);
        if (lock.matchedCount === 0) throw new TripNotFoundError();
        const result = await work({
          findMemberRole: async (userId) => {
            const member = await database.collection<{ role: TripRole }>("tripMembers")
              .findOne({ tripId: mongoTripId, userId: new MongoObjectId(userId) }, options);
            return ok(member?.role);
          },
          listDestinations: () => createMongoTripJourneyRepository(database, session).listDestinations(tripId),
          hasDestinationRecords: async (destinationId) => {
            const filter = { tripId: mongoTripId, destinationId: new MongoObjectId(destinationId) };
            for (const name of destinationRecordCollections) {
              if (await database.collection(name).findOne(filter, { ...options, projection: { _id: 1 } })) return ok(true);
            }
            return ok(false);
          },
          removeDestination: async (destinationId) => {
            await destinations.deleteOne({ _id: new MongoObjectId(destinationId), tripId: mongoTripId }, options);
            const remaining = await destinations.find({ tripId: mongoTripId }, options).sort({ order: 1 }).toArray();
            // Compact ascending: every vacated slot is free before the next write (unique index).
            for (const [index, destination] of remaining.entries()) {
              await destinations.updateOne({ _id: destination._id, tripId: mongoTripId }, { $set: { order: index + 1 } }, options);
            }
            return ok(undefined);
          },
          removeTrip: async () => {
            const photos = await database.collection("postPhotos").find({ tripId: mongoTripId },
              { ...options, projection: { s3Key: 1 } }).toArray();
            const objectKeys = [...new Set(photos.flatMap((photo) => typeof photo.s3Key === "string" && photo.s3Key !== "" ? [photo.s3Key] : []))];
            if (objectKeys.length > 0) {
              // Preserve cleanup intent atomically. S3 cleanup belongs to the photo integration worker.
              await database.collection("storageDeletionJobs").insertOne({ tripId: mongoTripId, objectKeys, createdAt: new Date() }, options);
            }
            for (const name of ["tripMembers", "destinations", "transports", "itineraryDays", "activities",
              "activityParticipations", "activityVotes", "posts", "postPhotos", "postExpenses", "postLikes", "comments", "commentLikes"]) {
              await database.collection(name).deleteMany({ tripId: mongoTripId }, options);
            }
            await database.collection("trips").deleteOne({ _id: mongoTripId }, options);
            return ok(undefined);
          },
        });
        if (!result.ok) throw result.error;
        return result;
      });
      return result ?? err(new UnknownError("Trip deletion transaction returned no result."));
    } catch (error) {
      return err(error instanceof TaggedError ? error : new UnknownError("Trip deletion database operation failed."));
    } finally { await session.endSession(); }
  },
});
