import { beforeEach, describe, expect, it } from "vitest";
import * as domain from "../../index.js";
import type { Comment, ObjectId, TripCommentPort, TripCommentScope, TripRole } from "../../index.js";

const id = (n: number): ObjectId => {
  const parsed = domain.createObjectId(n.toString(16).padStart(24, "0"));
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const tripId = id(1), actor = id(2), postId = id(3), otherPostId = id(4), otherTripId = id(5);
const createdAt = new Date("2026-10-04T12:00:00.789Z");
const seed = (fields: Partial<Comment> = {}): Comment => ({ id: id(10), tripId, postId, authorId: id(9),
  text: "Original", createdAt: new Date("2026-10-01T09:00:00.000Z"), ...fields });

describe("Trip comment use cases", () => {
  let role: TripRole | undefined, tripExists: boolean, posts: Record<string, { id: ObjectId; tripId: ObjectId }>;
  let records: Comment[], members: ObjectId[], sequence: number, writes: number, transactionError: boolean;
  let scope: TripCommentScope, comments: TripCommentPort;
  beforeEach(() => {
    role = "participant"; tripExists = true; records = []; members = [actor, id(9)]; sequence = 20; writes = 0; transactionError = false;
    posts = { [postId]: { id: postId, tripId }, [otherPostId]: { id: otherPostId, tripId }, [id(6)]: { id: id(6), tripId: otherTripId } };
    scope = {
      findMemberRole: async () => domain.ok(role),
      findTrip: async () => domain.ok(tripExists ? { id: tripId } : undefined),
      findPost: async (pid) => domain.ok(posts[pid]?.tripId === tripId ? posts[pid] : undefined),
      findComment: async (cid, pid) => domain.ok(records.find((c) => c.id === cid && c.tripId === tripId && c.postId === pid)),
      listComments: async (pid) => domain.ok(records.filter((c) => c.tripId === tripId && c.postId === pid)),
      listMemberUserIds: async (userIds) => domain.ok(userIds.filter((u) => members.includes(u))),
      insert: async (comment) => { writes++; records.push(comment); return domain.ok(undefined); },
      replaceText: async (comment) => { writes++; records = records.map((c) => c.id === comment.id ? { ...c, text: comment.text } : c); return domain.ok(undefined); },
    };
    comments = {
      withReadSnapshot: async (_, work) => work(scope),
      withTransaction: async (_, work) => {
        const before = structuredClone(records);
        const result = await work(scope);
        if (!result.ok || transactionError) { records = before; return result.ok ? domain.err(new domain.UnknownError("boom")) : result; }
        return result;
      },
    };
  });
  const dependencies = () => ({ comments, createId: () => id(sequence++), now: () => createdAt });
  const base = { tripId, authenticatedUserId: actor, postId };
  const create = (fields = {}) => domain.createTripPostComment.execute(dependencies(), { ...base, text: "Hola", ...fields });
  const update = (fields = {}) => domain.updateTripPostComment.execute(dependencies(), { ...base, commentId: id(10), text: "Editado", ...fields });
  const list = (fields = {}) => domain.listTripPostComments.execute(dependencies(), { ...base, ...fields });

  it("creates with server metadata and ignores client-supplied identity", async () => {
    expect(await create({ authorId: id(99), id: id(99), createdAt: new Date(0), text: "  Hola  " }))
      .toEqual({ ok: true, value: { id: id(20), tripId, postId, authorId: actor, text: "Hola", createdAt, authorIsFormerMember: false } });
    expect(records).toHaveLength(1);
  });

  it("rejects invalid text without writing", async () => {
    expect(await create({ text: "  " })).toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "text", code: "required" }] } });
    expect(await create({ text: 5 })).toMatchObject({ ok: false, error: { issues: [{ code: "invalid" }] } });
    expect(await create({ text: "a".repeat(2001) })).toMatchObject({ ok: false, error: { issues: [{ code: "too_long" }] } });
    expect(writes).toBe(0);
  });

  it.each([["create", () => create()], ["update", () => update()], ["list", () => list()]] as const)(
    "a non-member gets TripNotFoundError on %s without writing", async (_, run) => {
      records = [seed()];
      role = undefined;
      expect(await run()).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
      expect(writes).toBe(0);
    });

  it.each([["create", () => create()], ["update", () => update()], ["list", () => list()]] as const)(
    "a missing Trip gets TripNotFoundError on %s", async (_, run) => {
      tripExists = false;
      expect(await run()).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    });

  it.each([["create", (f: object) => create(f)], ["update", (f: object) => update(f)], ["list", (f: object) => list(f)]] as const)(
    "a post of another Trip or a missing post gets PostNotFoundError on %s", async (_, run) => {
      records = [seed()];
      expect(await run({ postId: id(6) })).toMatchObject({ ok: false, error: { tag: "PostNotFoundError" } });
      expect(await run({ postId: id(77) })).toMatchObject({ ok: false, error: { tag: "PostNotFoundError" } });
      expect(writes).toBe(0);
    });

  it("a comment of another post or missing gets CommentNotFoundError", async () => {
    records = [seed({ postId: otherPostId })];
    expect(await update()).toMatchObject({ ok: false, error: { tag: "CommentNotFoundError" } });
    expect(await update({ commentId: id(88) })).toMatchObject({ ok: false, error: { tag: "CommentNotFoundError" } });
    expect(records[0]!.text).toBe("Original");
  });

  it("any current member edits another member's comment keeping author and creation date", async () => {
    records = [seed()];
    const result = await update({ text: " Nuevo \n texto " });
    expect(result).toEqual({ ok: true, value: { ...seed(), text: "Nuevo \n texto", authorIsFormerMember: false } });
    expect(records[0]).toEqual({ ...seed(), text: "Nuevo \n texto" });
  });

  it("editing with the same text is idempotent", async () => {
    records = [seed()];
    expect(await update({ text: "Original" })).toMatchObject({ ok: true, value: { text: "Original", authorId: id(9) } });
    expect(records).toEqual([seed()]);
  });

  it("flags a former member author on update", async () => {
    records = [seed({ authorId: id(50) })];
    expect(await update()).toMatchObject({ ok: true, value: { authorId: id(50), authorIsFormerMember: true } });
  });

  it("rejects invalid text on update without changing the comment", async () => {
    records = [seed()];
    expect(await update({ text: "" })).toMatchObject({ ok: false, error: { issues: [{ field: "text", code: "required" }] } });
    expect(records).toEqual([seed()]);
  });

  it("does not write when the transaction fails", async () => {
    transactionError = true;
    expect(await create()).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
    expect(records).toEqual([]);
  });

  it("lists by creation time with id as tie-breaker, scoped to the post, flagging former members", async () => {
    const t = (s: string) => new Date(s);
    records = [seed({ id: id(13), createdAt: t("2026-10-02T00:00:00Z") }), seed({ id: id(12), createdAt: t("2026-10-02T00:00:00Z"), authorId: id(50) }),
      seed({ id: id(11), createdAt: t("2026-10-01T00:00:00Z"), authorId: actor }), seed({ id: id(14), postId: otherPostId })];
    const result = await list();
    expect(result.ok && result.value.map((c) => [c.id, c.authorIsFormerMember])).toEqual([[id(11), false], [id(12), true], [id(13), false]]);
  });
});
