import { createComment, editCommentText, type Comment } from "../../entities/comment.js";
import { CommentNotFoundError } from "../../errors/comment-not-found-error.js";
import { PostNotFoundError } from "../../errors/post-not-found-error.js";
import { TripNotFoundError } from "../../errors/trip-not-found-error.js";
import type { TripCommentPort, TripCommentReadScope } from "../../ports/trip-comment-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, ok, type AsyncResult } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";
import { emitToMembers } from "./notification-emission.js";

export interface TripCommentPayload { tripId: ObjectId; postId: ObjectId; authenticatedUserId: ObjectId }
export interface CreateTripPostCommentPayload extends TripCommentPayload { text: unknown }
export interface UpdateTripPostCommentPayload extends CreateTripPostCommentPayload { commentId: ObjectId }
/** A comment plus whether its author no longer belongs to the Trip (left or was expelled). */
export type CommentView = Comment & { authorIsFormerMember: boolean };
interface Dependencies { comments: TripCommentPort }
interface CreationDependencies extends Dependencies { createId: () => ObjectId; now: () => Date }

/** Only a current member of an existing Trip; anyone else gets the same not-found as a missing Trip. */
const authorize = async (scope: TripCommentReadScope, payload: TripCommentPayload) => {
  const member = await scope.findMemberRole(payload.authenticatedUserId);
  if (!member.ok) return member;
  if (member.value !== "admin" && member.value !== "participant") return err(new TripNotFoundError());
  const trip = await scope.findTrip();
  if (!trip.ok) return trip;
  return trip.value?.id === payload.tripId ? ok(trip.value) : err(new TripNotFoundError());
};
const findPost = async (scope: TripCommentReadScope, payload: TripCommentPayload) => {
  const post = await scope.findPost(payload.postId);
  if (!post.ok) return post;
  return post.value?.id === payload.postId && post.value.tripId === payload.tripId ? ok(post.value) : err(new PostNotFoundError());
};
const withMembership = async (scope: TripCommentReadScope, comments: Comment[]): AsyncResult<CommentView[]> => {
  const members = await scope.listMemberUserIds([...new Set(comments.map((comment) => comment.authorId))]);
  if (!members.ok) return members;
  const current = new Set(members.value);
  return ok(comments.map((comment) => ({ ...comment, authorIsFormerMember: !current.has(comment.authorId) })));
};

export const createTripPostComment: UseCase<CreationDependencies, CreateTripPostCommentPayload, CommentView, TaggedError> = {
  execute: ({ comments, createId, now }, payload) => comments.withTransaction<CommentView>(payload.tripId, async (scope) => {
    const trip = await authorize(scope, payload);
    if (!trip.ok) return trip;
    const post = await findPost(scope, payload);
    if (!post.ok) return post;
    const comment = createComment({ id: createId(), tripId: payload.tripId, postId: payload.postId,
      authorId: payload.authenticatedUserId, text: payload.text, createdAt: now() }, { post: post.value });
    if (!comment.ok) return comment;
    const inserted = await scope.insert(comment.value);
    if (!inserted.ok) return inserted;
    // Last write, same transaction: the event exists only if the comment does.
    const emitted = await emitToMembers(scope, [{ type: "comment.created", tripId: payload.tripId, operationRef: comment.value.id,
      actorId: payload.authenticatedUserId, exclude: [payload.authenticatedUserId], createdAt: comment.value.createdAt,
      payload: { commentId: comment.value.id, postId: payload.postId, actorId: payload.authenticatedUserId } }]);
    return emitted.ok ? ok({ ...comment.value, authorIsFormerMember: false }) : emitted;
  }),
};

/** Any current member may edit; author and creation date are never touched. */
export const updateTripPostComment: UseCase<Dependencies, UpdateTripPostCommentPayload, CommentView, TaggedError> = {
  execute: ({ comments }, payload) => comments.withTransaction<CommentView>(payload.tripId, async (scope) => {
    const trip = await authorize(scope, payload);
    if (!trip.ok) return trip;
    const post = await findPost(scope, payload);
    if (!post.ok) return post;
    const found = await scope.findComment(payload.commentId, payload.postId);
    if (!found.ok) return found;
    if (found.value === undefined || found.value.id !== payload.commentId || found.value.tripId !== payload.tripId
      || found.value.postId !== payload.postId) return err(new CommentNotFoundError());
    const edited = editCommentText(found.value, payload.text);
    if (!edited.ok) return edited;
    const replaced = await scope.replaceText(edited.value);
    if (!replaced.ok) return replaced;
    const views = await withMembership(scope, [edited.value]);
    return views.ok ? ok(views.value[0]!) : views;
  }),
};

export const listTripPostComments: UseCase<Dependencies, TripCommentPayload, CommentView[], TaggedError> = {
  execute: ({ comments }, payload) => comments.withReadSnapshot(payload.tripId, async (scope) => {
    const trip = await authorize(scope, payload);
    if (!trip.ok) return trip;
    const post = await findPost(scope, payload);
    if (!post.ok) return post;
    const listed = await scope.listComments(payload.postId);
    if (!listed.ok) return listed;
    const ordered = listed.value.filter((comment) => comment.tripId === payload.tripId && comment.postId === payload.postId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return withMembership(scope, ordered);
  }),
};
