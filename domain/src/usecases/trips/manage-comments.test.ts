import { beforeEach, describe, expect, it, vi } from "vitest";
import * as domain from "../../index.js";
import type { Comment, ObjectId, TripCommentPort, TripCommentScope, TripNotificationDraft, TripRole } from "../../index.js";

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
  let notifications: TripNotificationDraft[], appendError: boolean;
  let scope: TripCommentScope, comments: TripCommentPort;
  beforeEach(() => {
    role = "participant"; tripExists = true; records = []; members = [actor, id(9)]; sequence = 20; writes = 0; transactionError = false;
    notifications = []; appendError = false;
    posts = { [postId]: { id: postId, tripId }, [otherPostId]: { id: otherPostId, tripId }, [id(6)]: { id: id(6), tripId: otherTripId } };
    scope = {
      findMemberRole: async () => domain.ok(role),
      findTrip: async () => domain.ok(tripExists ? { id: tripId } : undefined),
      findPost: async (pid) => domain.ok(posts[pid]?.tripId === tripId ? posts[pid] : undefined),
      findComment: async (cid, pid) => domain.ok(records.find((c) => c.id === cid && c.tripId === tripId && c.postId === pid)),
      listComments: async (pid) => domain.ok(records.filter((c) => c.tripId === tripId && c.postId === pid)),
      listMemberUserIds: async (userIds) => domain.ok(userIds.filter((u) => members.includes(u))),
      listMemberIds: async () => domain.ok([...members]),
      appendNotifications: async (drafts) => {
        if (appendError) return domain.err(new domain.UnknownError("outbox down"));
        notifications.push(...drafts); return domain.ok(undefined);
      },
      insert: async (comment) => { writes++; records.push(comment); return domain.ok(undefined); },
      replaceText: async (comment) => { writes++; records = records.map((c) => c.id === comment.id ? { ...c, text: comment.text } : c); return domain.ok(undefined); },
    };
    comments = {
      withReadSnapshot: async (_, work) => work(scope),
      withTransaction: async (_, work) => {
        const before = structuredClone(records), notificationsBefore = [...notifications];
        const result = await work(scope);
        if (!result.ok || transactionError) { records = before; notifications = notificationsBefore; return result.ok ? domain.err(new domain.UnknownError("boom")) : result; }
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

  describe("notifications (T91)", () => {
    it("emits comment.created to the other current members and not to the author, with ids and no text", async () => {
      members = [actor, id(9), id(8)];
      const created = await create({ text: "Texto privado" });
      expect(created.ok).toBe(true);
      expect(notifications.map((n) => n.userId)).toEqual([id(9), id(8)]);
      expect(notifications).toEqual([id(9), id(8)].map((userId) => ({ eventKey: `comment.created:${id(20)}:${userId}`, type: "comment.created", tripId, userId,
        actorId: actor, operationKey: `comment.created:${id(20)}`, payload: { commentId: id(20), postId, actorId: actor }, createdAt })));
      expect(JSON.stringify(notifications)).not.toContain("Texto privado");
    });

    it("does not notify former members nor the author when alone", async () => {
      members = [actor];
      expect((await create()).ok).toBe(true);
      expect(notifications).toEqual([]);
    });

    it("emits nothing when the comment is rejected", async () => {
      expect((await create({ text: "  " })).ok).toBe(false);
      role = undefined;
      expect((await create()).ok).toBe(false);
      expect(notifications).toEqual([]);
    });

    it("does not emit when editing a comment", async () => {
      records = [seed({ authorId: actor })];
      expect((await update()).ok).toBe(true);
      expect(notifications).toEqual([]);
    });

    it("if the events cannot be written the comment is not saved either", async () => {
      appendError = true;
      expect(await create()).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(records).toEqual([]);
      expect(notifications).toEqual([]);
    });

    it("if the transaction fails after the events, none of them remains", async () => {
      transactionError = true;
      expect((await create()).ok).toBe(false);
      expect(records).toEqual([]);
      expect(notifications).toEqual([]);
    });
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

  describe("only the author edits the text (T124)", () => {
    const mine = () => seed({ authorId: actor });
    const forbidden = { ok: false, error: { tag: "UnauthorizedError" } };
    it("the author edits keeping author and creation date", async () => {
      records = [mine()];
      const result = await update({ text: " Nuevo \n texto " });
      expect(result).toEqual({ ok: true, value: { ...mine(), text: "Nuevo \n texto", authorIsFormerMember: false } });
      expect(records[0]).toEqual({ ...mine(), text: "Nuevo \n texto" });
    });

    it.each(["participant", "admin"] as const)("a %s who is not the author gets 403 without writing", async (memberRole) => {
      records = [seed()]; role = memberRole;
      const replace = vi.spyOn(scope, "replaceText");
      expect(await update()).toMatchObject(forbidden);
      expect(replace).not.toHaveBeenCalled(); expect(writes).toBe(0); expect(records).toEqual([seed()]);
    });

    it("nobody edits the comment of a former member", async () => {
      records = [seed({ authorId: id(50) })]; role = "admin";
      expect(await update()).toMatchObject(forbidden);
      expect(records).toEqual([seed({ authorId: id(50) })]);
    });

    it("a former member editing their own comment gets 404, like a non-member", async () => {
      records = [mine()]; role = undefined;
      expect(await update()).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
      expect(records).toEqual([mine()]);
    });

    it("a missing comment is 404 for anyone, and invalid text from a non author is 403, not 422", async () => {
      records = [seed()];
      expect(await update({ commentId: id(88) })).toMatchObject({ ok: false, error: { tag: "CommentNotFoundError" } });
      expect(await update({ text: "" })).toMatchObject(forbidden);
      expect(await update({ text: "a".repeat(2001) })).toMatchObject(forbidden);
      expect(records).toEqual([seed()]);
    });

    it("editing with the same text is idempotent", async () => {
      records = [mine()];
      expect(await update({ text: "Original" })).toMatchObject({ ok: true, value: { text: "Original", authorId: actor } });
      expect(records).toEqual([mine()]);
    });

    it("rejects invalid text from the author without changing the comment", async () => {
      records = [mine()];
      expect(await update({ text: "" })).toMatchObject({ ok: false, error: { issues: [{ field: "text", code: "required" }] } });
      expect(records).toEqual([mine()]);
    });
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
