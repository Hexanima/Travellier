import { MongoServerError, ObjectId as MongoObjectId, type ClientSession, type Collection } from "mongodb";
import { createObjectId, err, ok, PhotoConflictError, TripNotFoundError,
  type AsyncResult, type ObjectId, type PostPhoto } from "app-domain";

/** `postPhotos` record: references are ObjectId and `uploadedAt` a Date; the S3 key never leaves the server. */
export interface PostPhotoDocument {
  _id: MongoObjectId; postId: MongoObjectId; tripId: MongoObjectId; uploaderId: MongoObjectId;
  s3Key: string; order: number; uploadedAt: Date;
}
const domainId = (value: MongoObjectId): ObjectId => {
  const parsed = createObjectId(value.toHexString());
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
export const toPostPhoto = (value: PostPhotoDocument): PostPhoto => ({ id: domainId(value._id), postId: domainId(value.postId),
  tripId: domainId(value.tripId), uploaderId: domainId(value.uploaderId), s3Key: value.s3Key, order: value.order, uploadedAt: value.uploadedAt });
const toDocument = (photo: PostPhoto): PostPhotoDocument => ({ _id: new MongoObjectId(photo.id), postId: new MongoObjectId(photo.postId),
  tripId: new MongoObjectId(photo.tripId), uploaderId: new MongoObjectId(photo.uploaderId), s3Key: photo.s3Key, order: photo.order,
  uploadedAt: photo.uploadedAt });

/** Photos of several posts of one Trip, grouped by post and by `order` inside it (served by the `postId` / `postId_order_unique` index). */
export const postPhotosByPostsQuery = (tripId: MongoObjectId, postIds: readonly ObjectId[]) =>
  ({ filter: { tripId, postId: { $in: postIds.map((postId) => new MongoObjectId(postId)) } }, sort: { postId: 1, order: 1 } }) as const;

/** Photo reads/writes of a Trip scope; always pass the transaction session. */
export const createPostPhotoStore = (records: Collection<PostPhotoDocument>, tripId: ObjectId, session: ClientSession) => {
  const mongoTripId = new MongoObjectId(tripId), options = { session };
  return {
    listPhotos: async (postId: ObjectId): AsyncResult<PostPhoto[]> =>
      ok((await records.find({ postId: new MongoObjectId(postId), tripId: mongoTripId }, options).sort({ order: 1 }).toArray()).map(toPostPhoto)),
    /** Exact filter and sort of the gallery read; shared with the index test so the plan checked is the real one. */
    listPhotosByPosts: async (postIds: readonly ObjectId[]): AsyncResult<PostPhoto[]> => {
      const { filter, sort } = postPhotosByPostsQuery(mongoTripId, postIds);
      return ok((await records.find(filter, options).sort(sort).toArray()).map(toPostPhoto));
    },
    /** By id only: the use case compares `tripId` with the Trip it authorized. */
    findPhoto: async (photoId: ObjectId): AsyncResult<PostPhoto | undefined> => {
      const photo = await records.findOne({ _id: new MongoObjectId(photoId) }, options);
      return ok(photo === null ? undefined : toPostPhoto(photo));
    },
    findPhotosByKeys: async (keys: readonly string[]): AsyncResult<PostPhoto[]> =>
      ok((await records.find({ s3Key: { $in: [...keys] } }, options).toArray()).map(toPostPhoto)),
    insertPhotos: async (photos: readonly PostPhoto[]): AsyncResult<void> => {
      if (photos.length === 0) return ok(undefined);
      if (photos.some((photo) => photo.tripId !== tripId)) throw new TripNotFoundError();
      try {
        for (const photo of photos) await records.insertOne(toDocument(photo), options);
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000) return err(new PhotoConflictError());
        throw error;
      }
      return ok(undefined);
    },
  };
};
