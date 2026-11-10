import { ObjectId as MongoObjectId, type ClientSession, type Db } from "mongodb";
import { createObjectId, err, ok, TaggedError, TripNotFoundError, UnknownError,
  type AsyncResult, type CommentLikeSummary, type ObjectId, type TripLikePort, type TripLikeScope, type TripRole } from "app-domain";

const duplicateKeyCode = 11000;
const domainId = (value: MongoObjectId): ObjectId => {
  const parsed = createObjectId(value.toHexString());
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const isDuplicateKey = (error: unknown) => typeof error === "object" && error !== null && (error as { code?: unknown }).code === duplicateKeyCode;

const createScope = (database: Db, tripId: ObjectId, session: ClientSession): TripLikeScope => {
  const mongoTripId = new MongoObjectId(tripId), query = { tripId: mongoTripId }, options = { session };
  const postLikes = database.collection("postLikes"), commentLikes = database.collection("commentLikes");
  const ids = (values: ObjectId[]) => values.map((value) => new MongoObjectId(value));
  return {
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
      const comment = await database.collection("comments").findOne({ ...query, postId: new MongoObjectId(postId),
        _id: new MongoObjectId(commentId) }, { ...options, projection: { _id: 1, tripId: 1, postId: 1 } });
      return ok(comment === null ? undefined : { id: domainId(comment._id), tripId: domainId(comment.tripId), postId: domainId(comment.postId) });
    },
    countPostLikes: async (postId) => ok(await postLikes.countDocuments({ ...query, postId: new MongoObjectId(postId) }, options)),
    countCommentLikes: async (commentId) => ok(await commentLikes.countDocuments({ ...query, commentId: new MongoObjectId(commentId) }, options)),
    hasPostLike: async (postId, userId) => ok(await postLikes.countDocuments({ ...query, postId: new MongoObjectId(postId),
      userId: new MongoObjectId(userId) }, { ...options, limit: 1 }) > 0),
    hasCommentLike: async (commentId, userId) => ok(await commentLikes.countDocuments({ ...query, commentId: new MongoObjectId(commentId),
      userId: new MongoObjectId(userId) }, { ...options, limit: 1 }) > 0),
    listCommentLikeSummaries: async (postId, userId) => {
      const comments = await database.collection("comments").find({ ...query, postId: new MongoObjectId(postId) },
        { ...options, projection: { _id: 1 } }).sort({ createdAt: 1, _id: 1 }).toArray();
      const commentIds = comments.map((comment) => comment._id);
      const counts = await commentLikes.aggregate<{ _id: MongoObjectId; count: number }>([
        { $match: { ...query, commentId: { $in: commentIds } } }, { $group: { _id: "$commentId", count: { $sum: 1 } } }], options).toArray();
      const mine = await commentLikes.find({ ...query, commentId: { $in: commentIds }, userId: new MongoObjectId(userId) },
        { ...options, projection: { commentId: 1 } }).toArray();
      const countById = new Map(counts.map((entry) => [entry._id.toHexString(), entry.count]));
      const likedIds = new Set(mine.map((like) => (like.commentId as MongoObjectId).toHexString()));
      return ok(comments.map((comment): CommentLikeSummary => ({ commentId: domainId(comment._id),
        count: countById.get(comment._id.toHexString()) ?? 0, likedByMe: likedIds.has(comment._id.toHexString()) })));
    },
    insertPostLike: async (like) => {
      if (like.tripId !== tripId) throw new TripNotFoundError();
      const filter = { postId: new MongoObjectId(like.postId), userId: new MongoObjectId(like.userId) };
      try {
        const result = await postLikes.updateOne(filter, { $setOnInsert: { _id: new MongoObjectId(like.id), tripId: mongoTripId,
          createdAt: like.createdAt } }, { ...options, upsert: true });
        return ok(result.upsertedCount === 1);
      } catch (error) {
        // Safety net only: the Trip lock already serializes writers, so the unique index should never be hit.
        if (isDuplicateKey(error)) return ok(false);
        throw error;
      }
    },
    deletePostLike: async (postId, userId) => {
      await postLikes.deleteOne({ ...query, postId: new MongoObjectId(postId), userId: new MongoObjectId(userId) }, options);
      return ok(undefined);
    },
    insertCommentLike: async (like) => {
      if (like.tripId !== tripId) throw new TripNotFoundError();
      const filter = { commentId: new MongoObjectId(like.commentId), userId: new MongoObjectId(like.userId) };
      try {
        const result = await commentLikes.updateOne(filter, { $setOnInsert: { _id: new MongoObjectId(like.id), tripId: mongoTripId,
          createdAt: like.createdAt } }, { ...options, upsert: true });
        return ok(result.upsertedCount === 1);
      } catch (error) {
        if (isDuplicateKey(error)) return ok(false);
        throw error;
      }
    },
    deleteCommentLike: async (commentId, userId) => {
      await commentLikes.deleteOne({ ...query, commentId: new MongoObjectId(commentId), userId: new MongoObjectId(userId) }, options);
      return ok(undefined);
    },
  };
};

export const createMongoTripLikeRepository = (database: Db): TripLikePort => {
  const perform = async <T>(tripId: ObjectId, write: boolean, work: (scope: TripLikeScope) => AsyncResult<T>): AsyncResult<T> => {
    const session = database.client.startSession();
    try {
      const result = await session.withTransaction(async () => {
        if (write) {
          // Same Trip lock as membership revocation, Trip deletion, posts, comments and itinerary changes.
          // Taken even when the operation is idempotent, so a like never races with an expulsion or Trip deletion.
          const lock = await database.collection("trips").updateOne({ _id: new MongoObjectId(tripId) },
            { $inc: { destinationOrderRevision: 1 } }, { session });
          if (lock.matchedCount !== 1) throw new TripNotFoundError();
        }
        const result = await work(createScope(database, tripId, session));
        // Throw inside the callback to abort domain failures and preserve driver retry labels.
        if (!result.ok) throw result.error;
        return result;
      }, { readConcern: { level: "snapshot" }, readPreference: "primary" });
      return result ?? err(new UnknownError("Like transaction returned no result."));
    } catch (error) {
      return err(error instanceof TaggedError ? error : new UnknownError("Like database operation failed."));
    } finally { await session.endSession(); }
  };
  return {
    withReadSnapshot: (tripId, work) => perform(tripId, false, work),
    withTransaction: (tripId, work) => perform(tripId, true, work),
  };
};
