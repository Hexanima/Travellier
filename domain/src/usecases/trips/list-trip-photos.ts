import { projectPostRoots } from "../../entities/post-chain-projection.js";
import { comparePhotoPosition, encodePhotoCursor, parsePhotoCursor, type PhotoFilter, type PhotoPosition } from "../../entities/post-photo-cursor.js";
import type { PostPhoto } from "../../entities/post-photo.js";
import type { Post } from "../../entities/post.js";
import { ActivityNotFoundError } from "../../errors/activity-not-found-error.js";
import { TransportNotFoundError } from "../../errors/transport-not-found-error.js";
import { ValidationError, type ValidationIssue } from "../../errors/validation-error.js";
import type { ObjectStoragePort } from "../../ports/object-storage-port.js";
import type { TripPostPort } from "../../ports/trip-post-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, ok } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";
import { authorizeMember, signPhotos, type PostPhotoView } from "./manage-post-photos.js";

export interface ListTripPhotosPayload {
  tripId: ObjectId; authenticatedUserId: ObjectId;
  /** Raw `limit`: validated here (integer 1..60, default 30). */
  limit?: unknown;
  /** Raw opaque cursor: validated here. */
  cursor?: unknown;
  activityId?: ObjectId; transportId?: ObjectId;
}
export interface TripPhotoView extends PostPhotoView {
  post: { createdAt: Date; authorId: ObjectId; rootActivityId: ObjectId | null; rootTransportId: ObjectId | null };
}
export interface TripPhotoPage { photos: TripPhotoView[]; nextCursor: string | null }

interface Dependencies { posts: TripPostPort; storage: ObjectStoragePort; now: () => Date }

export const DEFAULT_PHOTO_PAGE_SIZE = 30;
export const MAX_PHOTO_PAGE_SIZE = 60;
/** Posts whose photos are read per query while filling a page; posts without photos are skipped. */
const POST_BATCH_SIZE = 50;

const parseLimit = (raw: unknown): number | undefined => {
  if (raw === undefined) return DEFAULT_PHOTO_PAGE_SIZE;
  const value = typeof raw === "string" ? (/^[0-9]{1,3}$/.test(raw) ? Number(raw) : NaN) : raw;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_PHOTO_PAGE_SIZE ? value : undefined;
};

interface Entry { photo: PostPhoto; post: Post; rootActivityId: ObjectId | null; rootTransportId: ObjectId | null; position: PhotoPosition }

const positionOf = (post: Post, order: number): PhotoPosition => ({ createdAtMs: post.createdAt.getTime(), postId: post.id, order });

/**
 * Photos of the whole Trip (the group gallery), newest publication first: `post.createdAt` desc, `post.id` desc, `order` asc.
 * A keyset cursor keeps pages free of duplicates and gaps while posts and photos are added. An activity/transport filter keeps
 * the photos of every post whose chain root belongs to it. Only current members read; URLs are signed for the page alone.
 */
export const listTripPhotos: UseCase<Dependencies, ListTripPhotosPayload, TripPhotoPage, TaggedError> = {
  execute: async ({ posts, storage, now }, payload) => {
    const { tripId } = payload;
    const found = await posts.withReadSnapshot(tripId, async (scope) => {
      const trip = await authorizeMember(scope, payload);
      if (!trip.ok) return trip;

      const issues: ValidationIssue[] = [];
      const limit = parseLimit(payload.limit);
      if (limit === undefined) issues.push({ field: "limit", code: "invalid", message: `Limit must be an integer between 1 and ${MAX_PHOTO_PAGE_SIZE}.` });
      const { activityId, transportId } = payload;
      if (activityId !== undefined && transportId !== undefined) {
        issues.push({ field: "filter", code: "conflict", message: "Filter by activity or by transport, not both." });
      }
      let cursor: PhotoPosition | undefined;
      const filter: PhotoFilter | undefined = activityId !== undefined && transportId !== undefined ? undefined
        : activityId !== undefined ? `a:${activityId}` : transportId !== undefined ? `t:${transportId}` : "all";
      if (filter !== undefined && payload.cursor !== undefined) {
        const parsed = parsePhotoCursor(payload.cursor, { tripId, filter });
        if (parsed.ok) cursor = parsed.value; else issues.push(...parsed.error.issues);
      }
      if (issues.length > 0 || limit === undefined) return err(new ValidationError(issues));

      if (activityId !== undefined) {
        const activity = await scope.findActivity(activityId);
        if (!activity.ok) return activity;
        if (activity.value?.id !== activityId || activity.value.tripId !== tripId) return err(new ActivityNotFoundError());
      }
      if (transportId !== undefined) {
        const transport = await scope.findTransport(transportId);
        if (!transport.ok) return transport;
        if (transport.value?.id !== transportId || transport.value.tripId !== tripId) return err(new TransportNotFoundError());
      }

      const listed = await scope.list();
      if (!listed.ok) return listed;
      const tripPosts = listed.value.filter((post) => post.tripId === tripId);
      const roots = projectPostRoots(tripPosts);
      const eligible = tripPosts
        .filter((post) => {
          const root = roots.get(post.id)!;
          return activityId !== undefined ? root.activityId === activityId : transportId !== undefined ? root.transportId === transportId : true;
        })
        .map((post) => ({ post, root: roots.get(post.id)! }))
        .sort((a, b) => comparePhotoPosition(positionOf(a.post, 0), positionOf(b.post, 0)))
        // The cursor post stays: only its later photos pass the per-photo check below.
        .filter(({ post }) => cursor === undefined || comparePhotoPosition(positionOf(post, Number.MAX_SAFE_INTEGER), cursor) > 0);

      // One extra photo tells whether another page exists without a count.
      const wanted = limit + 1, entries: Entry[] = [];
      for (let start = 0; start < eligible.length && entries.length < wanted; start += POST_BATCH_SIZE) {
        const batch = eligible.slice(start, start + POST_BATCH_SIZE);
        const byPost = new Map(batch.map((value) => [value.post.id, value]));
        const photos = await scope.listPhotosByPosts(batch.map(({ post }) => post.id));
        if (!photos.ok) return photos;
        const entriesOfBatch: Entry[] = [];
        for (const photo of photos.value) {
          const owner = byPost.get(photo.postId);
          if (owner === undefined || photo.tripId !== tripId) continue;
          const position = positionOf(owner.post, photo.order);
          if (cursor !== undefined && comparePhotoPosition(position, cursor) <= 0) continue;
          entriesOfBatch.push({ photo, post: owner.post, rootActivityId: owner.root.activityId, rootTransportId: owner.root.transportId, position });
        }
        entries.push(...entriesOfBatch.sort((a, b) => comparePhotoPosition(a.position, b.position)));
      }
      const page = entries.slice(0, limit);
      const nextCursor = entries.length > limit ? encodePhotoCursor({ tripId, filter: filter!, position: page[page.length - 1]!.position }) : null;
      return ok({ page, nextCursor });
    });
    if (!found.ok) return found;
    const signed = await signPhotos(storage, now, found.value.page.map((entry) => entry.photo));
    if (!signed.ok) return signed;
    return ok({
      photos: signed.value.map((view, index) => {
        const { post, rootActivityId, rootTransportId } = found.value.page[index]!;
        return { ...view, post: { createdAt: post.createdAt, authorId: post.authorId, rootActivityId, rootTransportId } };
      }),
      nextCursor: found.value.nextCursor,
    });
  },
};
