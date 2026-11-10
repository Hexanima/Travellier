import { beforeEach, describe, expect, it } from "vitest";
import * as domain from "../../index.js";
import type { CommentLike, ObjectId, PostLike, TripLikePort, TripLikeScope, TripRole } from "../../index.js";

const id = (n: number): ObjectId => {
  const parsed = domain.createObjectId(n.toString(16).padStart(24, "0"));
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const tripId = id(1), actor = id(2), postId = id(3), otherTripId = id(5), commentId = id(10);
const createdAt = new Date("2026-10-04T12:00:00.789Z");

describe("Trip like use cases", () => {
  let role: TripRole | undefined, tripExists: boolean, posts: Record<string, { id: ObjectId; tripId: ObjectId }>;
  let comments: Array<{ id: ObjectId; tripId: ObjectId; postId: ObjectId }>;
  let postLikes: PostLike[], commentLikes: CommentLike[], sequence: number, writes: number, transactionError: boolean;
  let scope: TripLikeScope, likes: TripLikePort;
  beforeEach(() => {
    role = "participant"; tripExists = true; postLikes = []; commentLikes = []; sequence = 20; writes = 0; transactionError = false;
    posts = { [postId]: { id: postId, tripId }, [id(4)]: { id: id(4), tripId }, [id(6)]: { id: id(6), tripId: otherTripId } };
    comments = [{ id: commentId, tripId, postId }, { id: id(11), tripId, postId: id(4) }, { id: id(12), tripId: otherTripId, postId: id(6) }];
    scope = {
      findMemberRole: async () => domain.ok(role),
      findTrip: async () => domain.ok(tripExists ? { id: tripId } : undefined),
      findPost: async (pid) => domain.ok(posts[pid]?.tripId === tripId ? posts[pid] : undefined),
      findComment: async (cid, pid) => domain.ok(comments.find((c) => c.id === cid && c.tripId === tripId && c.postId === pid)),
      countPostLikes: async (pid) => domain.ok(postLikes.filter((l) => l.tripId === tripId && l.postId === pid).length),
      countCommentLikes: async (cid) => domain.ok(commentLikes.filter((l) => l.tripId === tripId && l.commentId === cid).length),
      hasPostLike: async (pid, uid) => domain.ok(postLikes.some((l) => l.postId === pid && l.userId === uid)),
      hasCommentLike: async (cid, uid) => domain.ok(commentLikes.some((l) => l.commentId === cid && l.userId === uid)),
      listCommentLikeSummaries: async (pid, uid) => domain.ok(comments.filter((c) => c.tripId === tripId && c.postId === pid).map((c) => ({
        commentId: c.id, count: commentLikes.filter((l) => l.commentId === c.id).length,
        likedByMe: commentLikes.some((l) => l.commentId === c.id && l.userId === uid) }))),
      insertPostLike: async (like) => {
        writes++;
        if (postLikes.some((l) => l.postId === like.postId && l.userId === like.userId)) return domain.ok(false);
        postLikes.push(like); return domain.ok(true);
      },
      deletePostLike: async (pid, uid) => { writes++; postLikes = postLikes.filter((l) => !(l.postId === pid && l.userId === uid)); return domain.ok(undefined); },
      insertCommentLike: async (like) => {
        writes++;
        if (commentLikes.some((l) => l.commentId === like.commentId && l.userId === like.userId)) return domain.ok(false);
        commentLikes.push(like); return domain.ok(true);
      },
      deleteCommentLike: async (cid, uid) => { writes++; commentLikes = commentLikes.filter((l) => !(l.commentId === cid && l.userId === uid)); return domain.ok(undefined); },
    };
    likes = {
      withReadSnapshot: async (_, work) => work(scope),
      withTransaction: async (_, work) => {
        const before = [structuredClone(postLikes), structuredClone(commentLikes)] as const;
        const result = await work(scope);
        if (!result.ok || transactionError) {
          [postLikes, commentLikes] = before;
          return result.ok ? domain.err(new domain.UnknownError("boom")) : result;
        }
        return result;
      },
    };
  });
  const dependencies = () => ({ likes, createId: () => id(sequence++), now: () => createdAt });
  const base = { tripId, authenticatedUserId: actor, postId };
  const likePost = (fields = {}) => domain.likeTripPost.execute(dependencies(), { ...base, ...fields });
  const unlikePost = (fields = {}) => domain.unlikeTripPost.execute(dependencies(), { ...base, ...fields });
  const likeComment = (fields = {}) => domain.likeTripComment.execute(dependencies(), { ...base, commentId, ...fields });
  const unlikeComment = (fields = {}) => domain.unlikeTripComment.execute(dependencies(), { ...base, commentId, ...fields });
  const read = (fields = {}) => domain.getTripPostLikes.execute(dependencies(), { ...base, ...fields });
  const postLike = (userId: ObjectId, n = 40): PostLike => ({ id: id(n), tripId, postId, userId, createdAt });
  const commentLike = (userId: ObjectId, n = 50): CommentLike => ({ id: id(n), tripId, commentId, userId, createdAt });

  it("likes a post once, with server metadata, and returns the state", async () => {
    expect(await likePost()).toEqual({ ok: true, value: { liked: true, count: 1 } });
    expect(postLikes).toEqual([{ id: id(20), tripId, postId, userId: actor, createdAt }]);
  });

  it("repeating like does not duplicate and repeating unlike stays at zero", async () => {
    const results = [await likePost(), await likePost(), await unlikePost(), await unlikePost()];
    expect(results.map((r) => r.ok && [r.value.liked, r.value.count])).toEqual([[true, 1], [true, 1], [false, 0], [false, 0]]);
    expect(postLikes).toEqual([]);
  });

  it("likes and unlikes a comment idempotently", async () => {
    const results = [await likeComment(), await likeComment(), await unlikeComment(), await unlikeComment()];
    expect(results.map((r) => r.ok && [r.value.liked, r.value.count])).toEqual([[true, 1], [true, 1], [false, 0], [false, 0]]);
    expect(commentLikes).toEqual([]);
  });

  it("only removes the caller's like and counts other members' likes", async () => {
    postLikes = [postLike(id(9))]; commentLikes = [commentLike(id(9))];
    expect(await likePost()).toEqual({ ok: true, value: { liked: true, count: 2 } });
    expect(await unlikePost()).toEqual({ ok: true, value: { liked: false, count: 1 } });
    expect(await likeComment()).toEqual({ ok: true, value: { liked: true, count: 2 } });
    expect(await unlikeComment()).toEqual({ ok: true, value: { liked: false, count: 1 } });
    expect(postLikes).toEqual([postLike(id(9))]);
  });

  it("keeps post likes and comment likes independent", async () => {
    await likePost();
    expect(commentLikes).toEqual([]);
    await likeComment(); await unlikePost();
    expect(commentLikes).toHaveLength(1);
  });

  it("ignores identity supplied by the client", async () => {
    await likePost({ userId: id(99), id: id(99), createdAt: new Date(0), tripId });
    expect(postLikes).toEqual([{ id: id(20), tripId, postId, userId: actor, createdAt }]);
  });

  it("counts likes of former members and keeps their identity", async () => {
    postLikes = [postLike(id(50))]; commentLikes = [commentLike(id(50))];
    expect(await likePost()).toMatchObject({ ok: true, value: { count: 2 } });
    expect(await likeComment()).toMatchObject({ ok: true, value: { count: 2 } });
    expect(postLikes.map((l) => l.userId)).toEqual([id(50), actor]);
  });

  const operations = [["likePost", () => likePost()], ["unlikePost", () => unlikePost()], ["likeComment", () => likeComment()],
    ["unlikeComment", () => unlikeComment()], ["read", () => read()]] as const;

  it.each(operations)("a non-member or former member gets TripNotFoundError on %s without writing", async (_, run) => {
    postLikes = [postLike(actor)]; role = undefined;
    expect(await run()).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(writes).toBe(0);
    expect(postLikes).toEqual([postLike(actor)]);
  });

  it.each(operations)("a missing Trip gets TripNotFoundError on %s", async (_, run) => {
    tripExists = false;
    expect(await run()).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(writes).toBe(0);
  });

  it.each(operations)("a Trip different from the payload gets TripNotFoundError on %s", async (_, run) => {
    scope = { ...scope, findTrip: async () => domain.ok({ id: otherTripId }) };
    expect(await run()).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(writes).toBe(0);
  });

  it.each([["likePost", (f: object) => likePost(f)], ["unlikePost", (f: object) => unlikePost(f)], ["likeComment", (f: object) => likeComment(f)],
    ["unlikeComment", (f: object) => unlikeComment(f)], ["read", (f: object) => read(f)]] as const)(
    "a post of another Trip or a missing post gets PostNotFoundError on %s", async (_, run) => {
      expect(await run({ postId: id(6) })).toMatchObject({ ok: false, error: { tag: "PostNotFoundError" } });
      expect(await run({ postId: id(77) })).toMatchObject({ ok: false, error: { tag: "PostNotFoundError" } });
      expect(writes).toBe(0);
    });

  it.each([["likeComment", (f: object) => likeComment(f)], ["unlikeComment", (f: object) => unlikeComment(f)]] as const)(
    "a comment of another post, another Trip or missing gets CommentNotFoundError on %s", async (_, run) => {
      expect(await run({ commentId: id(11) })).toMatchObject({ ok: false, error: { tag: "CommentNotFoundError" } });
      expect(await run({ commentId: id(12) })).toMatchObject({ ok: false, error: { tag: "CommentNotFoundError" } });
      expect(await run({ commentId: id(88) })).toMatchObject({ ok: false, error: { tag: "CommentNotFoundError" } });
      expect(writes).toBe(0);
      expect(commentLikes).toEqual([]);
    });

  it("does not leave a like when the transaction fails", async () => {
    transactionError = true;
    expect(await likePost()).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
    expect(await likeComment()).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
    expect(postLikes).toEqual([]);
    expect(commentLikes).toEqual([]);
  });

  it("reads counts and the caller's likes, including every comment of the post, without writing", async () => {
    comments.push({ id: id(13), tripId, postId });
    postLikes = [postLike(actor), postLike(id(50), 41)];
    commentLikes = [commentLike(actor), commentLike(id(9), 51), commentLike(id(50), 52), { ...commentLike(actor, 53), commentId: id(11) }];
    expect(await read()).toEqual({ ok: true, value: { post: { count: 2, likedByMe: true },
      comments: [{ commentId, count: 3, likedByMe: true }, { commentId: id(13), count: 0, likedByMe: false }] } });
    expect(await read({ authenticatedUserId: id(9) })).toMatchObject({ ok: true, value: { post: { count: 2, likedByMe: false },
      comments: [{ commentId, count: 3, likedByMe: true }, { commentId: id(13), count: 0, likedByMe: false }] } });
    expect(writes).toBe(0);
  });
});
