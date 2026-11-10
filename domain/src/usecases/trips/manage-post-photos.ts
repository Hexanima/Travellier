import {
  buildPostPhotos, checkPhotoObject, createPhotoUploadKey, parsePhotoReferences, parsePhotoUploadKey, PHOTO_DOWNLOAD_EXPIRES_SECONDS,
  PHOTO_UPLOAD_EXPIRES_SECONDS, validatePhotoUploadRequest, type PostPhoto, type PostPhotoRef,
} from "../../entities/post-photo.js";
import { PhotoConflictError } from "../../errors/photo-conflict-error.js";
import { PhotoNotFoundError } from "../../errors/photo-not-found-error.js";
import { PostNotFoundError } from "../../errors/post-not-found-error.js";
import { TripNotFoundError } from "../../errors/trip-not-found-error.js";
import { UnknownError } from "../../errors/unknown-error.js";
import { ValidationError, type ValidationIssue } from "../../errors/validation-error.js";
import type { ObjectStoragePort, UploadTarget } from "../../ports/object-storage-port.js";
import type { TripPostPort, TripPostReadScope, TripPostScope } from "../../ports/trip-post-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, ok, type AsyncResult } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";

export interface PhotoUploadPayload { tripId: ObjectId; authenticatedUserId: ObjectId; files: unknown }
export type PhotoUploadView = UploadTarget & { key: string };
export interface PostPhotoPayload { tripId: ObjectId; authenticatedUserId: ObjectId; postId: ObjectId }
export interface PhotoPayload { tripId: ObjectId; authenticatedUserId: ObjectId; photoId: ObjectId }
/** Photo metadata plus a short-lived signed GET; the S3 key is never exposed and the URL is never persisted. */
export interface PostPhotoView extends Pick<PostPhoto, "id" | "postId" | "order" | "uploadedAt" | "uploaderId"> {
  url: string;
  expiresAt: Date;
}
/** Photos to register with a post save, already checked against the rules and the current state of the post. */
export interface PostPhotoPlan { toInsert: PostPhoto[]; photos: PostPhotoRef[] }

interface UploadDependencies { posts: TripPostPort; storage: ObjectStoragePort; createUploadId: () => string }
interface ReadDependencies { posts: TripPostPort; storage: ObjectStoragePort; now: () => Date }

/** Current role of the actor in this Trip snapshot; a non-member or former member is a `TripNotFoundError`. */
export const authorizeMember = async (scope: TripPostReadScope, payload: { tripId: ObjectId; authenticatedUserId: ObjectId }) => {
  const member = await scope.findMemberRole(payload.authenticatedUserId);
  if (!member.ok) return member;
  if (member.value !== "admin" && member.value !== "participant") return err(new TripNotFoundError());
  const trip = await scope.findTrip();
  if (!trip.ok) return trip;
  return trip.value?.id === payload.tripId ? ok(trip.value) : err(new TripNotFoundError());
};

/** Authorizes the batch (snapshot of the current membership, no lock) and signs one PUT per file on a freshly reserved key. */
export const createTripPhotoUploads: UseCase<UploadDependencies, PhotoUploadPayload, { uploads: PhotoUploadView[] }, TaggedError> = {
  execute: async ({ posts, storage, createUploadId }, payload) => {
    const authorized = await posts.withReadSnapshot(payload.tripId, async (scope) => authorizeMember(scope, payload));
    if (!authorized.ok) return authorized;
    const files = validatePhotoUploadRequest(payload.files);
    if (!files.ok) return files;
    const uploads: PhotoUploadView[] = [];
    for (const file of files.value) {
      const key = createPhotoUploadKey({ tripId: payload.tripId, userId: payload.authenticatedUserId, uploadId: createUploadId(), extension: file.extension });
      const target = await storage.createUploadTarget({ objectKey: key, contentType: file.contentType,
        expiresInSeconds: PHOTO_UPLOAD_EXPIRES_SECONDS, contentLength: file.sizeBytes });
      if (!target.ok) return target;
      uploads.push({ key, ...target.value });
    }
    return ok({ uploads });
  },
};

/**
 * Validates the photo keys of a post save and checks each object in the storage (existence, size and stored type).
 * It runs BEFORE the transaction so the Trip lock is never held during storage I/O; membership is revalidated under the lock later.
 */
export const verifyPhotoUploads = async (storage: ObjectStoragePort | undefined,
  input: { tripId: ObjectId; userId: ObjectId; photos: unknown }): AsyncResult<string[]> => {
  const keys = parsePhotoReferences(input);
  if (!keys.ok) return keys;
  if (storage === undefined) return err(new UnknownError("Object storage is not configured."));
  const heads = await Promise.all(keys.value.map((key) => storage.headObject({ objectKey: key })));
  const issues: ValidationIssue[] = [];
  for (const [index, head] of heads.entries()) {
    if (!head.ok) return head;
    const parsed = parsePhotoUploadKey(keys.value[index]);
    const code = parsed === undefined ? "invalid" : checkPhotoObject(parsed.extension, head.value);
    if (code !== undefined) issues.push({ field: `photos[${index}].key`, code, message: `Photo upload is not usable (${code}).` });
  }
  return issues.length > 0 ? err(new ValidationError(issues)) : ok(keys.value);
};

/** Same as `verifyPhotoUploads`, but a save without `photos` skips the storage entirely. */
export const verifyOptionalPhotoUploads = (storage: ObjectStoragePort | undefined,
  input: { tripId: ObjectId; userId: ObjectId; photos?: unknown }): AsyncResult<string[] | undefined> =>
  input.photos === undefined ? Promise.resolve(ok(undefined)) : verifyPhotoUploads(storage, { ...input, photos: input.photos });

/**
 * Inside the post transaction: decides which photos are new for this post. A key already registered in the same post is a
 * no-op (retry); one registered in another post is a conflict; the post total is capped. Writes nothing.
 */
export const planPostPhotos = async (scope: TripPostScope, input: { tripId: ObjectId; postId: ObjectId; uploaderId: ObjectId;
  keys: readonly string[]; createId: () => ObjectId; uploadedAt: Date }): AsyncResult<PostPhotoPlan> => {
  const existing = await scope.listPhotos(input.postId);
  if (!existing.ok) return existing;
  const registered = await scope.findPhotosByKeys(input.keys);
  if (!registered.ok) return registered;
  if (registered.value.some((photo) => photo.postId !== input.postId)) return err(new PhotoConflictError());
  return buildPostPhotos({ ...input, existing: existing.value });
};

/** Writes the planned photos; call it after the post itself is stored in the same transaction. */
export const registerPostPhotos = async (scope: TripPostScope, plan: PostPhotoPlan): AsyncResult<PostPhotoRef[]> => {
  if (plan.toInsert.length > 0) {
    const inserted = await scope.insertPhotos(plan.toInsert);
    if (!inserted.ok) return inserted;
  }
  return ok(plan.photos);
};

/** Signs one short-lived GET per photo (same expiry for all); nothing is persisted and the S3 key is not exposed. */
export const signPhotos = async (storage: ObjectStoragePort, now: () => Date, photos: readonly PostPhoto[]): AsyncResult<PostPhotoView[]> => {
  const expiresAt = new Date(now().getTime() + PHOTO_DOWNLOAD_EXPIRES_SECONDS * 1000);
  const views: PostPhotoView[] = [];
  for (const photo of photos) {
    const target = await storage.createDownloadTarget({ objectKey: photo.s3Key, expiresInSeconds: PHOTO_DOWNLOAD_EXPIRES_SECONDS });
    if (!target.ok) return target;
    views.push({ id: photo.id, postId: photo.postId, order: photo.order, uploadedAt: photo.uploadedAt, uploaderId: photo.uploaderId,
      url: target.value.downloadUrl, expiresAt });
  }
  return ok(views);
};

/** Photos of a post with short-lived signed GET URLs; only current members of the Trip (former members get 404). */
export const getTripPostPhotos: UseCase<ReadDependencies, PostPhotoPayload, PostPhotoView[], TaggedError> = {
  execute: async ({ posts, storage, now }, payload) => {
    const found = await posts.withReadSnapshot(payload.tripId, async (scope) => {
      const trip = await authorizeMember(scope, payload);
      if (!trip.ok) return trip;
      const post = await scope.find(payload.postId);
      if (!post.ok) return post;
      if (post.value?.id !== payload.postId || post.value.tripId !== payload.tripId) return err(new PostNotFoundError());
      const photos = await scope.listPhotos(payload.postId);
      return photos.ok ? ok(photos.value.filter((photo) => photo.tripId === payload.tripId && photo.postId === payload.postId)) : photos;
    });
    return found.ok ? signPhotos(storage, now, found.value) : found;
  },
};

/**
 * One photo with a signed GET URL. The photo is looked up by id and its own `tripId` must be the Trip whose current membership
 * was authorized, otherwise it is a 404 that does not reveal whether the photo exists elsewhere.
 */
export const getTripPhoto: UseCase<ReadDependencies, PhotoPayload, PostPhotoView, TaggedError> = {
  execute: async ({ posts, storage, now }, payload) => {
    const found = await posts.withReadSnapshot(payload.tripId, async (scope) => {
      const trip = await authorizeMember(scope, payload);
      if (!trip.ok) return trip;
      const photo = await scope.findPhoto(payload.photoId);
      if (!photo.ok) return photo;
      return photo.value?.id === payload.photoId && photo.value.tripId === payload.tripId ? ok(photo.value) : err(new PhotoNotFoundError());
    });
    if (!found.ok) return found;
    const views = await signPhotos(storage, now, [found.value]);
    return views.ok ? ok(views.value[0]!) : views;
  },
};
