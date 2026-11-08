import { ObjectId as MongoObjectId, type ClientSession, type Db } from "mongodb";
import { createObjectId, err, ok, PostNotFoundError, TaggedError, TripNotFoundError, UnknownError,
  type Activity, type AsyncResult, type ObjectId, type Post, type TripPostPort, type TripPostScope, type TripRole } from "app-domain";
import { toActivity, toActivityDocument, type ActivityDocument } from "./activity-document.js";
import { createParticipationStore, type ParticipationDocument } from "./activity-participation-store.js";
import { createMongoTripJourneyRepository } from "./trip-journey-repository.js";

/** `dayId` exists only in records created before T54; it is never required, read into a Post or written here. */
type PostDocument = Omit<Post, "id" | "tripId" | "dayId" | "authorId" | "activityId" | "parentPostId" | "transportId"> & {
  _id: MongoObjectId; tripId: MongoObjectId; dayId?: MongoObjectId | null; authorId: MongoObjectId;
  activityId: MongoObjectId | null; parentPostId: MongoObjectId | null; transportId: MongoObjectId | null;
};
const domainId = (value: MongoObjectId): ObjectId => {
  const parsed = createObjectId(value.toHexString());
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const optionalId = (value: MongoObjectId | null | undefined) => value == null ? null : domainId(value);
const mongoId = (value: ObjectId | null) => value === null ? null : new MongoObjectId(value);
const editable = (post: Post) => ({ description: post.description, mapsUrl: post.mapsUrl,
  activityId: mongoId(post.activityId), parentPostId: mongoId(post.parentPostId), transportId: mongoId(post.transportId) });
const toPost = (value: PostDocument): Post => ({ id: domainId(value._id), tripId: domainId(value.tripId),
  authorId: domainId(value.authorId), description: value.description, mapsUrl: value.mapsUrl, createdAt: value.createdAt,
  activityId: optionalId(value.activityId), parentPostId: optionalId(value.parentPostId), transportId: optionalId(value.transportId) });

/** Exact filter and sort `listChildren` runs; shared with the index test so the plan checked is the real one. */
export const childPostsQuery = (tripId: MongoObjectId, postId: MongoObjectId) =>
  ({ filter: { tripId, parentPostId: postId }, sort: { createdAt: -1, _id: -1 } }) as const;

const createScope = (database: Db, tripId: ObjectId, session: ClientSession): TripPostScope => {
  const mongoTripId = new MongoObjectId(tripId), query = { tripId: mongoTripId }, options = { session };
  const posts = database.collection<PostDocument>("posts");
  const store = createParticipationStore(database.collection<ParticipationDocument>("activityParticipations"), tripId, session);
  const reference = async (name: "activities" | "transports", referenceId: ObjectId) => {
    const value = await database.collection(name).findOne({ ...query, _id: new MongoObjectId(referenceId) },
      { ...options, projection: { _id: 1, tripId: 1 } });
    return ok(value === null ? undefined : { id: domainId(value._id), tripId: domainId(value.tripId) });
  };
  return {
    findMemberRole: async (userId) => {
      const member = await database.collection<{ role: TripRole }>("tripMembers")
        .findOne({ ...query, userId: new MongoObjectId(userId) }, options);
      return ok(member?.role);
    },
    findTrip: async () => {
      const trip = await database.collection("trips")
        .findOne({ _id: mongoTripId }, { ...options, projection: { _id: 1 } });
      return ok(trip === null ? undefined : { id: tripId });
    },
    listDays: () => createMongoTripJourneyRepository(database, session).listItineraryDays(tripId),
    findActivity: (id) => reference("activities", id),
    findTransport: (id) => reference("transports", id),
    find: async (postId) => {
      const post = await posts.findOne({ ...query, _id: new MongoObjectId(postId) }, options);
      return ok(post === null ? undefined : toPost(post));
    },
    // The index serves the publication order; the use case applies the stable id-descending tie-break.
    list: async () => ok((await posts.find(query, options).sort({ createdAt: -1 }).toArray()).map(toPost)),
    // Planner uses the parentPostId index (checked by explain in post-persistence tests); the tripId filter and the sort run on its results.
    listChildren: async (postId) => {
      const { filter, sort } = childPostsQuery(mongoTripId, new MongoObjectId(postId));
      return ok((await posts.find(filter, options).sort(sort).toArray()).map(toPost));
    },
    insert: async (post) => {
      if (post.tripId !== tripId) throw new TripNotFoundError();
      await posts.insertOne({ _id: new MongoObjectId(post.id), tripId: mongoTripId, authorId: new MongoObjectId(post.authorId),
        createdAt: post.createdAt, ...editable(post) }, options);
      return ok(undefined);
    },
    replace: async (post) => {
      if (post.tripId !== tripId) throw new PostNotFoundError();
      const result = await posts.updateOne({ ...query, _id: new MongoObjectId(post.id) }, { $set: editable(post) }, options);
      if (result.matchedCount !== 1) throw new PostNotFoundError();
      return ok(undefined);
    },
    insertActivity: async (activity: Activity) => {
      if (activity.tripId !== tripId) throw new TripNotFoundError();
      await database.collection<ActivityDocument>("activities").insertOne(toActivityDocument(activity), options);
      return ok(undefined);
    },
    listActivities: async () => ok((await database.collection<ActivityDocument>("activities").find(query, options)
      .sort({ scheduledAt: 1, _id: 1 }).toArray()).map(toActivity)),
    listUserParticipations: store.listUserParticipations,
    saveParticipation: store.save,
  };
};

export const createMongoTripPostRepository = (database: Db): TripPostPort => {
  const perform = async <T>(tripId: ObjectId, write: boolean, work: (scope: TripPostScope) => AsyncResult<T>): AsyncResult<T> => {
    const session = database.client.startSession();
    try {
      const result = await session.withTransaction(async () => {
        if (write) {
          // Coordinate with itinerary changes, activity/Trip deletion and membership revocation.
          const lock = await database.collection("trips").updateOne({ _id: new MongoObjectId(tripId) },
            { $inc: { destinationOrderRevision: 1 } }, { session });
          if (lock.matchedCount !== 1) throw new TripNotFoundError();
        }
        const result = await work(createScope(database, tripId, session));
        // Throw inside the callback to abort domain failures and preserve driver retry labels.
        if (!result.ok) throw result.error;
        return result;
      }, { readConcern: { level: "snapshot" }, readPreference: "primary" });
      return result ?? err(new UnknownError("Post transaction returned no result."));
    } catch (error) {
      return err(error instanceof TaggedError ? error : new UnknownError("Post database operation failed."));
    } finally { await session.endSession(); }
  };
  return {
    withReadSnapshot: (tripId, work) => perform(tripId, false, work),
    withTransaction: (tripId, work) => perform(tripId, true, work),
  };
};
