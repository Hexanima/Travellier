import { ObjectId as MongoObjectId, type ClientSession, type Db } from "mongodb";
import { CommentNotFoundError, createObjectId, err, ok, TaggedError, TripNotFoundError, UnknownError,
  type AsyncResult, type Comment, type ObjectId, type TripCommentPort, type TripCommentScope, type TripRole } from "app-domain";
import { createOutboxStore } from "./outbox-store.js";

type CommentDocument = { _id: MongoObjectId; postId: MongoObjectId; authorId: MongoObjectId; tripId: MongoObjectId;
  text: string; createdAt: Date };
const domainId = (value: MongoObjectId): ObjectId => {
  const parsed = createObjectId(value.toHexString());
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const toComment = (value: CommentDocument): Comment => ({ id: domainId(value._id), tripId: domainId(value.tripId),
  postId: domainId(value.postId), authorId: domainId(value.authorId), text: value.text, createdAt: value.createdAt });

/** Exact filter and sort `listComments` runs; shared with the index test so the plan checked is the real one. */
export const commentsQuery = (tripId: MongoObjectId, postId: MongoObjectId) =>
  ({ filter: { tripId, postId }, sort: { createdAt: 1, _id: 1 } }) as const;

const createScope = (database: Db, tripId: ObjectId, session: ClientSession): TripCommentScope => {
  const mongoTripId = new MongoObjectId(tripId), query = { tripId: mongoTripId }, options = { session };
  const comments = database.collection<CommentDocument>("comments");
  const outbox = createOutboxStore(database, tripId, session);
  return {
    ...outbox,
    findMemberRole: async (userId) => {
      const member = await database.collection<{ role: TripRole }>("tripMembers")
        .findOne({ ...query, userId: new MongoObjectId(userId) }, options);
      return ok(member?.role);
    },
    findTrip: async () => {
      const trip = await database.collection("trips").findOne({ _id: mongoTripId }, { ...options, projection: { _id: 1 } });
      return ok(trip === null ? undefined : { id: tripId });
    },
    findPost: async (postId) => {
      const post = await database.collection("posts")
        .findOne({ ...query, _id: new MongoObjectId(postId) }, { ...options, projection: { _id: 1, tripId: 1 } });
      return ok(post === null ? undefined : { id: domainId(post._id), tripId: domainId(post.tripId) });
    },
    findComment: async (commentId, postId) => {
      const comment = await comments.findOne({ ...query, postId: new MongoObjectId(postId), _id: new MongoObjectId(commentId) }, options);
      return ok(comment === null ? undefined : toComment(comment));
    },
    listComments: async (postId) => {
      const { filter, sort } = commentsQuery(mongoTripId, new MongoObjectId(postId));
      return ok((await comments.find(filter, options).sort(sort).toArray()).map(toComment));
    },
    listMemberUserIds: async (userIds) => {
      const members = await database.collection<{ userId: MongoObjectId }>("tripMembers")
        .find({ ...query, userId: { $in: userIds.map((id) => new MongoObjectId(id)) } }, { ...options, projection: { userId: 1 } }).toArray();
      return ok(members.map((member) => domainId(member.userId)));
    },
    insert: async (comment) => {
      if (comment.tripId !== tripId) throw new TripNotFoundError();
      await comments.insertOne({ _id: new MongoObjectId(comment.id), postId: new MongoObjectId(comment.postId),
        authorId: new MongoObjectId(comment.authorId), tripId: mongoTripId, text: comment.text, createdAt: comment.createdAt }, options);
      return ok(undefined);
    },
    replaceText: async (comment) => {
      if (comment.tripId !== tripId) throw new CommentNotFoundError();
      const result = await comments.updateOne({ ...query, postId: new MongoObjectId(comment.postId), _id: new MongoObjectId(comment.id) },
        { $set: { text: comment.text } }, options);
      if (result.matchedCount !== 1) throw new CommentNotFoundError();
      return ok(undefined);
    },
    deleteComment: async (commentId, postId) => {
      const result = await comments.deleteOne({ ...query, postId: new MongoObjectId(postId), _id: new MongoObjectId(commentId) }, options);
      if (result.deletedCount !== 1) throw new CommentNotFoundError();
      await database.collection("commentLikes").deleteMany({ ...query, commentId: new MongoObjectId(commentId) }, options);
      return ok(undefined);
    },
  };
};

export const createMongoTripCommentRepository = (database: Db): TripCommentPort => {
  const perform = async <T>(tripId: ObjectId, write: boolean, work: (scope: TripCommentScope) => AsyncResult<T>): AsyncResult<T> => {
    const session = database.client.startSession();
    try {
      const result = await session.withTransaction(async () => {
        if (write) {
          // Same Trip lock as membership revocation, Trip deletion, posts and itinerary changes.
          const lock = await database.collection("trips").updateOne({ _id: new MongoObjectId(tripId) },
            { $inc: { destinationOrderRevision: 1 } }, { session });
          if (lock.matchedCount !== 1) throw new TripNotFoundError();
        }
        const result = await work(createScope(database, tripId, session));
        // Throw inside the callback to abort domain failures and preserve driver retry labels.
        if (!result.ok) throw result.error;
        return result;
      }, { readConcern: { level: "snapshot" }, readPreference: "primary" });
      return result ?? err(new UnknownError("Comment transaction returned no result."));
    } catch (error) {
      return err(error instanceof TaggedError ? error : new UnknownError("Comment database operation failed."));
    } finally { await session.endSession(); }
  };
  return {
    withReadSnapshot: (tripId, work) => perform(tripId, false, work),
    withTransaction: (tripId, work) => perform(tripId, true, work),
  };
};
