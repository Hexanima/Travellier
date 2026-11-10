import { ValidationError, type ValidationIssue } from "../errors/validation-error.js";
import { err, ok, type Result } from "../types/result.js";
import { createObjectId, type ObjectId } from "../value-objects/object-id.js";

/** Allowed image types and their key extension (same set as avatars; HEIC is not supported). */
export const PHOTO_EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
export type PhotoContentType = keyof typeof PHOTO_EXTENSIONS;
export type PhotoExtension = (typeof PHOTO_EXTENSIONS)[PhotoContentType];
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTOS_PER_BATCH = 10;
export const MAX_PHOTOS_PER_POST = 10;
export const PHOTO_UPLOAD_EXPIRES_SECONDS = 900;
export const PHOTO_DOWNLOAD_EXPIRES_SECONDS = 300;

/** Metadata of one photo of a post; the bucket is private and the S3 key is never exposed to clients. */
export interface PostPhoto {
  id: ObjectId;
  postId: ObjectId;
  tripId: ObjectId;
  /** Author of the upload; kept after leaving the Trip to identify a former member. */
  uploaderId: ObjectId;
  s3Key: string;
  /** Position inside the post, contiguous from 1. */
  order: number;
  uploadedAt: Date;
}

export interface PostPhotoRef { id: ObjectId; order: number }
/** What a storage `headObject` reports (`undefined` when the object does not exist). */
export interface PhotoObjectHead { contentType: string | null; sizeBytes: number }
export interface PhotoUploadFile { contentType: PhotoContentType; sizeBytes: number; extension: PhotoExtension }
export interface PhotoUploadKey { tripId: ObjectId; userId: ObjectId; uploadId: string; extension: PhotoExtension }

const uploadKeyPattern = /^trips\/([0-9a-f]{24})\/photos\/([0-9a-f]{24})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|png|webp)$/;
const extensions = new Set<string>(Object.values(PHOTO_EXTENSIONS));

const issue = (field: string, code: string, message: string): ValidationIssue => ({ field, code, message });
const failure = (issues: ValidationIssue[]) => err(new ValidationError(issues));

/** Key reserved for an upload: `trips/<tripId>/photos/<userId>/<uploadId>.<ext>`. */
export const createPhotoUploadKey = (input: { tripId: ObjectId; userId: ObjectId; uploadId: string; extension: PhotoExtension }): string =>
  `trips/${input.tripId}/photos/${input.userId}/${input.uploadId}.${input.extension}`;

/** Exact-format parser of the key (no `..`, no foreign prefix, no unsupported extension); `undefined` when it is not a photo key. */
export const parsePhotoUploadKey = (value: unknown): PhotoUploadKey | undefined => {
  if (typeof value !== "string") return undefined;
  const match = uploadKeyPattern.exec(value);
  if (!match) return undefined;
  const tripId = createObjectId(match[1] ?? ""), userId = createObjectId(match[2] ?? "");
  const extension = match[4] ?? "";
  if (!tripId.ok || !userId.ok || !extensions.has(extension)) return undefined;
  return { tripId: tripId.value, userId: userId.value, uploadId: match[3] ?? "", extension: extension as PhotoExtension };
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Validates the files a client wants to upload (1..10); lists every failure. */
export const validatePhotoUploadRequest = (files: unknown): Result<PhotoUploadFile[], ValidationError> => {
  if (!Array.isArray(files) || files.length === 0) return failure([issue("files", "required", "At least one file is required.")]);
  if (files.length > MAX_PHOTOS_PER_BATCH) return failure([issue("files", "too_many", `At most ${MAX_PHOTOS_PER_BATCH} files per batch.`)]);
  const issues: ValidationIssue[] = [], accepted: PhotoUploadFile[] = [];
  files.forEach((file: unknown, index) => {
    const { contentType, sizeBytes } = record(file) ?? {};
    const extension = typeof contentType === "string" && Object.hasOwn(PHOTO_EXTENSIONS, contentType)
      ? PHOTO_EXTENSIONS[contentType as PhotoContentType] : undefined;
    let valid = true;
    if (extension === undefined) {
      issues.push(issue(`files[${index}].contentType`, "unsupported", "Unsupported photo type."));
      valid = false;
    }
    if (typeof sizeBytes !== "number" || !Number.isInteger(sizeBytes) || sizeBytes <= 0) {
      issues.push(issue(`files[${index}].sizeBytes`, "invalid", "Photo size must be a positive integer."));
      valid = false;
    } else if (sizeBytes > MAX_PHOTO_BYTES) {
      issues.push(issue(`files[${index}].sizeBytes`, "too_large", "Photo exceeds the maximum size."));
      valid = false;
    }
    if (valid) accepted.push({ contentType: contentType as PhotoContentType, sizeBytes: sizeBytes as number, extension: extension! });
  });
  return issues.length > 0 ? failure(issues) : ok(accepted);
};

/**
 * Pure validation of the keys a post save wants to attach: format, ownership (this Trip and this user) and duplicates inside the request.
 * Returns the keys in request order; lists every failure.
 */
export const parsePhotoReferences = (input: { tripId: ObjectId; userId: ObjectId; photos: unknown }): Result<string[], ValidationError> => {
  const { photos } = input;
  if (!Array.isArray(photos) || photos.length === 0) return failure([issue("photos", "invalid", "Photos must be a non-empty list.")]);
  if (photos.length > MAX_PHOTOS_PER_POST) {
    return failure([issue("photos", "too_many", `A post holds at most ${MAX_PHOTOS_PER_POST} photos.`)]);
  }
  const issues: ValidationIssue[] = [], keys: string[] = [], seen = new Set<string>();
  photos.forEach((photo: unknown, index) => {
    const key = record(photo)?.key;
    const parsed = parsePhotoUploadKey(key);
    if (parsed === undefined || parsed.tripId !== input.tripId || parsed.userId !== input.userId) {
      issues.push(issue(`photos[${index}].key`, "invalid", "Photo key is not valid for this Trip and user."));
    } else if (seen.has(key as string)) {
      issues.push(issue(`photos[${index}].key`, "duplicate", "Photo key is repeated."));
    } else {
      seen.add(key as string);
      keys.push(key as string);
    }
  });
  return issues.length > 0 ? failure(issues) : ok(keys);
};

/** Compares what the storage holds with the rules; returns the failure code or `undefined` when the object is usable. */
export const checkPhotoObject = (extension: PhotoExtension, head: PhotoObjectHead | undefined):
  "not_uploaded" | "too_large" | "content_type_mismatch" | undefined => {
  if (head === undefined || head.sizeBytes <= 0) return "not_uploaded";
  if (head.sizeBytes > MAX_PHOTO_BYTES) return "too_large";
  const contentType = head.contentType?.split(";")[0]?.trim().toLowerCase();
  return contentType !== undefined && Object.hasOwn(PHOTO_EXTENSIONS, contentType) &&
    PHOTO_EXTENSIONS[contentType as PhotoContentType] === extension ? undefined : "content_type_mismatch";
};

/**
 * New photos of a post: keys already registered in it are a no-op (idempotent retry), the others continue the existing `order`
 * (contiguous from 1) and the post total is capped. `photos` lists the whole post in order.
 */
export const buildPostPhotos = (input: { postId: ObjectId; tripId: ObjectId; uploaderId: ObjectId; keys: readonly string[];
  existing: readonly PostPhoto[]; createId: () => ObjectId; uploadedAt: Date }):
  Result<{ toInsert: PostPhoto[]; photos: PostPhotoRef[] }, ValidationError> => {
  const registered = new Set(input.existing.map((photo) => photo.s3Key));
  const fresh = input.keys.filter((key, index) => !registered.has(key) && input.keys.indexOf(key) === index);
  if (input.existing.length + fresh.length > MAX_PHOTOS_PER_POST) {
    return failure([issue("photos", "too_many", `A post holds at most ${MAX_PHOTOS_PER_POST} photos.`)]);
  }
  const last = input.existing.reduce((max, photo) => Math.max(max, photo.order), 0);
  const toInsert = fresh.map((s3Key, index): PostPhoto => ({ id: input.createId(), postId: input.postId, tripId: input.tripId,
    uploaderId: input.uploaderId, s3Key, order: last + index + 1, uploadedAt: input.uploadedAt }));
  const photos = [...input.existing, ...toInsert].sort((a, b) => a.order - b.order).map(({ id, order }) => ({ id, order }));
  return ok({ toInsert, photos });
};
