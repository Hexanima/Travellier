import { createActivity, type Activity } from "../../entities/activity.js";
import { createPost, relinkPost, type CreatePostContext, type Post, type PostLinks } from "../../entities/post.js";
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
export type PostEditableFields = Pick<Post, "dayId" | "description" | "mapsUrl" | keyof PostLinks>;
export type NewPostActivity = Pick<Activity, "title" | "scheduledAt"> & Partial<Pick<Activity, "description" | "mapsUrl">>;
export type CreateTripPostPayload = TripPostPayload & Pick<Post, "dayId"> & Partial<Omit<PostEditableFields, "dayId">> & {
  newActivity?: NewPostActivity;
};
export type UpdateTripPostPayload = PostDetailPayload & Partial<PostEditableFields>;
export interface CreateTripPostResult { post: Post; activity?: Activity }
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
const resolve = async (scope: TripPostReadScope, post: Pick<Post, "tripId" | "dayId"> & Partial<PostLinks>,
  activity?: Activity): AsyncResult<CreatePostContext> => {
  const days = await scope.listDays();
  if (!days.ok) return days;
  const resolvedActivity = activity ? ok(activity) : post.activityId == null ? ok(undefined) : await scope.findActivity(post.activityId);
  if (!resolvedActivity.ok) return resolvedActivity;
  const parent = post.parentPostId == null ? ok(undefined) : await scope.find(post.parentPostId);
  if (!parent.ok) return parent;
  const transport = post.transportId == null ? ok(undefined) : await scope.findTransport(post.transportId);
  if (!transport.ok) return transport;
  return ok({ trip: { id: post.tripId }, day: days.value.find((day) => day.id === post.dayId),
    activity: resolvedActivity.value, parentPost: parent.value, transport: transport.value });
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
      const validated = createActivity({ id: createId(), tripId: payload.tripId, dayId: payload.dayId,
        title: payload.newActivity.title, scheduledAt: payload.newActivity.scheduledAt,
        description: payload.newActivity.description, mapsUrl: payload.newActivity.mapsUrl,
        createdBy: payload.authenticatedUserId, createdAt }, { trip: trip.value, days: days.value });
      if (!validated.ok) return validated;
      activity = validated.value;
    }
    const input = { id: postId, tripId: payload.tripId, dayId: payload.dayId, authorId: payload.authenticatedUserId,
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
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))) : result;
  }),
};

export const getTripPost: UseCase<Dependencies, PostDetailPayload, Post, TaggedError> = {
  execute: ({ posts }, payload) => posts.withReadSnapshot(payload.tripId, async (scope) => {
    const trip = await authorize(scope, payload);
    return trip.ok ? find(scope, payload) : trip;
  }),
};

export const updateTripPost: UseCase<Dependencies, UpdateTripPostPayload, Post, TaggedError> = {
  execute: ({ posts }, payload) => posts.withTransaction(payload.tripId, async (scope) => {
    const trip = await authorize(scope, payload);
    if (!trip.ok) return trip;
    const current = await find(scope, payload);
    if (!current.ok) return current;
    const fields = ["dayId", "description", "mapsUrl", "activityId", "parentPostId", "transportId"] as const;
    const supplied = fields.filter((field) => Object.hasOwn(payload, field) && payload[field] !== undefined);
    if (supplied.length === 0) return err(new ValidationError([{ field: "post", code: "required", message: "An editable field is required." }]));
    const merged: Post = { ...current.value, ...Object.fromEntries(supplied.map((field) => [field, payload[field]])) };
    const resolved = await resolve(scope, merged);
    if (!resolved.ok) return resolved;
    const post = relinkPost(merged, {}, resolved.value);
    if (!post.ok) return post;
    const saved = await scope.replace(post.value);
    return saved.ok ? post : saved;
  }),
};
