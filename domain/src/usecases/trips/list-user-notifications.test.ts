import { describe, expect, it } from "vitest";

import * as domain from "../../index.js";
import type { ObjectId, UserNotificationQueryPort, UserNotificationView } from "../../index.js";

const id = (n: number): ObjectId => {
  const parsed = domain.createObjectId(n.toString(16).padStart(24, "0"));
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const user = id(1), tripId = id(2);
const view = (n: number): UserNotificationView => ({ id: id(100 + n), type: "post.created", tripId, actorId: id(3),
  payload: { postId: id(50 + n), actorId: id(3), activityId: null }, createdAt: new Date(Date.UTC(2026, 9, 4, 12) - n * 1000) });

const fake = (all: UserNotificationView[]) => {
  const calls: { userId: ObjectId; limit: number; after?: { createdAtMs: number; id: ObjectId } }[] = [];
  const notifications: UserNotificationQueryPort = {
    listForUser: async (input) => {
      calls.push(input);
      const rest = input.after === undefined ? all : all.filter((n) => domain.compareNotificationPosition(
        { createdAtMs: n.createdAt.getTime(), id: n.id }, input.after!) > 0);
      return domain.ok(rest.slice(0, input.limit));
    },
  };
  return { notifications, calls };
};

describe("listUserNotifications", () => {
  it("reads the notifications of the authenticated user with the default page size", async () => {
    const { notifications, calls } = fake([view(0), view(1)]);
    const result = await domain.listUserNotifications.execute({ notifications }, { authenticatedUserId: user });
    expect(result).toEqual(domain.ok({ notifications: [view(0), view(1)], nextCursor: null }));
    expect(calls).toEqual([{ userId: user, limit: domain.DEFAULT_NOTIFICATION_PAGE_SIZE + 1 }]);
    expect(domain.DEFAULT_NOTIFICATION_PAGE_SIZE).toBe(30);
    expect(domain.MAX_NOTIFICATION_PAGE_SIZE).toBe(60);
  });

  it("pages with an opaque cursor without gaps or duplicates", async () => {
    const all = [0, 1, 2, 3, 4].map(view);
    const { notifications } = fake(all);
    const first = await domain.listUserNotifications.execute({ notifications }, { authenticatedUserId: user, limit: "2" });
    expect(first).toMatchObject({ ok: true, value: { notifications: [view(0), view(1)] } });
    const cursor = first.ok ? first.value.nextCursor : null;
    expect(cursor).toEqual(expect.any(String));
    const second = await domain.listUserNotifications.execute({ notifications }, { authenticatedUserId: user, limit: 2, cursor });
    expect(second).toMatchObject({ ok: true, value: { notifications: [view(2), view(3)] } });
    const third = await domain.listUserNotifications.execute({ notifications }, { authenticatedUserId: user, limit: 2,
      cursor: second.ok ? second.value.nextCursor : null });
    expect(third).toEqual(domain.ok({ notifications: [view(4)], nextCursor: null }));
  });

  it.each([["0"], ["61"], ["abc"], [1.5], [-1], [""]])("rejects limit %s with a 422 field", async (limit) => {
    const { notifications, calls } = fake([view(0)]);
    expect(await domain.listUserNotifications.execute({ notifications }, { authenticatedUserId: user, limit }))
      .toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "limit", code: "invalid" }] } });
    expect(calls).toEqual([]);
  });

  it("rejects an invalid cursor with a 422 field and reads nothing", async () => {
    const { notifications, calls } = fake([view(0)]);
    expect(await domain.listUserNotifications.execute({ notifications }, { authenticatedUserId: user, cursor: "basura" }))
      .toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "cursor", code: "invalid" }] } });
    expect(calls).toEqual([]);
  });

  it("reports both invalid parameters together", async () => {
    const { notifications } = fake([]);
    const result = await domain.listUserNotifications.execute({ notifications }, { authenticatedUserId: user, limit: "0", cursor: "x" });
    expect(result).toMatchObject({ ok: false, error: { issues: [{ field: "limit" }, { field: "cursor" }] } });
  });

  it("returns the port error unchanged", async () => {
    const notifications: UserNotificationQueryPort = { listForUser: async () => domain.err(new domain.UnknownError("boom")) };
    expect(await domain.listUserNotifications.execute({ notifications }, { authenticatedUserId: user }))
      .toMatchObject({ ok: false, error: { tag: "UnknownError" } });
  });
});
