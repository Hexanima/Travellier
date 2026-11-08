import { createActivity, type Activity } from "../../entities/activity.js";
import { createPost, MAX_POST_CHAIN_DEPTH, relinkPost, resolvePostChain, type CreatePostContext, type Post, type PostLinks } from "../../entities/post.js";
import { PostNotFoundError } from "../../errors/post-not-found-error.js";
import { TripNotFoundError } from "../../errors/trip-not-found-error.js";
import { ValidationError } from "../../errors/validation-error.js";
import type { TripPostPort, TripPostReadScope } from "../../ports/trip-post-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, ok, type AsyncResult } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";

export interface TripPostPayload { tripId: ObjectId; authenticatedUserId: ObjectId }
export interface PostDetailPayload extends TripPostPayload { postId: ObjectId }
export type PostEditableFields = Pick<Post, "description" | "mapsUrl" | keyof PostLinks>;
export type NewPostActivity = Pick<Activity, "title" | "scheduledAt"> &
  Partial<Pick<Activity, "description" | "mapsUrl" | "durationMinutes">>;
/** `dayId` only feeds the new activity (transitional until T58); the post itself never stores or validates a day. */
export type CreateTripPostPayload = TripPostPayload & Partial<PostEditableFields> & {
  dayId?: ObjectId;
  newActivity?: NewPostActivity;
};
export type UpdateTripPostPayload = PostDetailPayload & Partial<PostEditableFields>;
export interface CreateTripPostResult { post: Post; activity?: Activity }
export type PostSummary = Pick<Post, "id" | "authorId" | "createdAt" | "description">;
export interface TripPostChainResult {
  post: Post;
  parent: PostSummary | null;
  children: PostSummary[];
  /** Activity of the highest ancestor; null when the root has none or stored data is inconsistent. */
  rootActivityId: ObjectId | null;
}
interface Dependencies { posts: TripPostPort }
interface CreationDependencies extends Dependencies { createId: () => ObjectId; now: () => Date }

const authorize = async (scope: TripPostReadScope, payload: TripPostPayload) => {
  const member = await scope.findMemberRole(payload.authenticatedUserId);
  if (!member.ok) return member;
  if (member.value !== "admin" && member.value !== "participant") return err(new TripNotFoundError());
  const trip = await scope.findTrip();
  if (!trip.ok) return trip;
  return trip.value?.id === payload.tripId ? ok(trip.value) : err(new TripNotFoundError());
};
const find = async (scope: TripPostReadScope, payload: PostDetailPayload): AsyncResult<Post> => {
  const post = await scope.find(payload.postId);
  if (!post.ok) return post;
  return post.value?.id === payload.postId && post.value.tripId === payload.tripId ? ok(post.value) : err(new PostNotFoundError());
};
const resolve = async (scope: TripPostReadScope, post: Pick<Post, "tripId"> & Partial<PostLinks>,
  activity?: Activity): AsyncResult<CreatePostContext> => {
  const resolvedActivity = activity ? ok(activity) : post.activityId == null ? ok(undefined) : await scope.findActivity(post.activityId);
  if (!resolvedActivity.ok) return resolvedActivity;
  const parent = post.parentPostId == null ? ok(undefined) : await scope.find(post.parentPostId);
  if (!parent.ok) return parent;
  const transport = post.transportId == null ? ok(undefined) : await scope.findTransport(post.transportId);
  if (!transport.ok) return transport;
  return ok({ trip: { id: post.tripId },
    activity: resolvedActivity.value, parentPost: parent.value, transport: transport.value });
};

const summarize = (post: Post): PostSummary =>
  ({ id: post.id, authorId: post.authorId, createdAt: post.createdAt, description: post.description });
/** Loads the ancestors of `startId` (inclusive) inside the scope; stops on a revisited post or flags `truncated` at the technical limit. */
const loadAncestors = async (scope: TripPostReadScope, tripId: ObjectId, startId: ObjectId):
  AsyncResult<{ posts: Post[]; truncated: boolean }> => {
  const visited = new Set<ObjectId>(), loaded: Post[] = [];
  let next: ObjectId | null = startId;
  while (next !== null && !visited.has(next)) {
    if (loaded.length >= MAX_POST_CHAIN_DEPTH) return ok({ posts: loaded, truncated: true });
    visited.add(next);
    const found = await scope.find(next);
    if (!found.ok) return found;
    if (found.value === undefined || found.value.tripId !== tripId) break;
    loaded.push(found.value);
    next = found.value.parentPostId;
  }
  return ok({ posts: loaded, truncated: false });
};

export const createTripPost: UseCase<CreationDependencies, CreateTripPostPayload, CreateTripPostResult, TaggedError> = {
  execute: ({ posts, createId, now }, payload) => posts.withTransaction(payload.tripId, async (scope) => {
    const trip = await authorize(scope, payload);
    if (!trip.ok) return trip;
    const postId = createId(), createdAt = now();
    let activity: Activity | undefined;
    if (payload.newActivity !== undefined) {
      if (payload.activityId != null) return err(new ValidationError([{ field: "activityId", code: "conflict",
        message: "Choose an existing activity or create a new one." }]));
      const days = await scope.listDays();
      if (!days.ok) return days;
      const validated = createActivity({ id: createId(), tripId: payload.tripId, dayId: payload.dayId as ObjectId,
        title: payload.newActivity.title, scheduledAt: payload.newActivity.scheduledAt,
        durationMinutes: payload.newActivity.durationMinutes,
        description: payload.newActivity.description, mapsUrl: payload.newActivity.mapsUrl,
        createdBy: payload.authenticatedUserId, createdAt }, { trip: trip.value, days: days.value });
      if (!validated.ok) return validated;
      activity = validated.value;
    }
    const input = { id: postId, tripId: payload.tripId, authorId: payload.authenticatedUserId,
      createdAt, description: payload.description, mapsUrl: payload.mapsUrl,
      activityId: activity?.id ?? payload.activityId, parentPostId: payload.parentPostId, transportId: payload.transportId };
    const resolved = await resolve(scope, input, activity);
    if (!resolved.ok) return resolved;
    const post = createPost(input, resolved.value);
    if (!post.ok) return post;
    if (activity) {
      const saved = await scope.insertActivity(activity);
      if (!saved.ok) return saved;
    }
    const saved = await scope.insert(post.value);
    return saved.ok ? ok({ post: post.value, ...(activity ? { activity } : {}) }) : saved;
  }),
};

export const listTripPosts: UseCase<Dependencies, TripPostPayload, Post[], TaggedError> = {
  execute: ({ posts }, payload) => posts.withReadSnapshot(payload.tripId, async (scope) => {
    const trip = await authorize(scope, payload);
    if (!trip.ok) return trip;
    const result = await scope.list();
    return result.ok ? ok(result.value.filter((p) => p.tripId === payload.tripId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))) : result;
  }),
};

export const getTripPost: UseCase<Dependencies, PostDetailPayload, Post, TaggedError> = {
  execute: ({ posts }, payload) => posts.withReadSnapshot(payload.tripId, async (scope) => {
    const trip = await authorize(scope, payload);
    return trip.ok ? find(scope, payload) : trip;
  }),
};

export const getTripPostChain: UseCase<Dependencies, PostDetailPayload, TripPostChainResult, TaggedError> = {
  execute: ({ posts }, payload) => posts.withReadSnapshot(payload.tripId, async (scope) => {
    const trip = await authorize(scope, payload);
    if (!trip.ok) return trip;
    const post = await find(scope, payload);
    if (!post.ok) return post;
    const children = await scope.listChildren(post.value.id);
    if (!children.ok) return children;
    const loaded = post.value.parentPostId === null ? ok({ posts: [] as Post[], truncated: false })
      : await loadAncestors(scope, payload.tripId, post.value.parentPostId);
    if (!loaded.ok) return loaded;
    const ancestors = { ok: true as const, value: loaded.value.posts };
    const byId = new Map(ancestors.value.map((ancestor) => [ancestor.id, ancestor]));
    const chain = resolvePostChain(post.value, (id) => byId.get(id));
    return ok({ post: post.value, parent: ancestors.value[0] !== undefined && ancestors.value[0].id === post.value.parentPostId
      ? summarize(ancestors.value[0]) : null,
    children: children.value.filter((child) => child.tripId === payload.tripId && child.parentPostId === post.value.id)
      .map(summarize), rootActivityId: chain.ok ? chain.value.rootActivityId : null });
  }),
};

export const updateTripPost: UseCase<Dependencies, UpdateTripPostPayload, Post, TaggedError> = {
  execute: ({ posts }, payload) => posts.withTransaction(payload.tripId, async (scope) => {
    const trip = await authorize(scope, payload);
    if (!trip.ok) return trip;
    const current = await find(scope, payload);
    if (!current.ok) return current;
    const fields = ["description", "mapsUrl", "activityId", "parentPostId", "transportId"] as const;
    const supplied = fields.filter((field) => Object.hasOwn(payload, field) && payload[field] !== undefined);
    if (supplied.length === 0) return err(new ValidationError([{ field: "post", code: "required", message: "An editable field is required." }]));
    const merged: Post = { ...current.value, ...Object.fromEntries(supplied.map((field) => [field, payload[field]])) };
    const resolved = await resolve(scope, merged);
    if (!resolved.ok) return resolved;
    const post = relinkPost(merged, {}, resolved.value);
    if (!post.ok) return post;
    const parentId = post.value.parentPostId;
    if (parentId !== null && parentId !== current.value.parentPostId && parentId !== post.value.id) {
      // Same scope as the write: the Trip lock serializes concurrent link edits.
      const ancestors = await loadAncestors(scope, payload.tripId, parentId);
      if (!ancestors.ok) return ancestors;
      if (ancestors.value.posts.some((ancestor) => ancestor.id === post.value.id)) {
        return err(new ValidationError([{ field: "parentPostId", code: "cycle", message: "Post cannot become a descendant of itself." }]));
      }
      if (ancestors.value.truncated) {
        return err(new ValidationError([{ field: "parentPostId", code: "too_deep", message: "Post chain exceeds the supported depth." }]));
      }
    }
    const saved = await scope.replace(post.value);
    return saved.ok ? post : saved;
  }),
};
