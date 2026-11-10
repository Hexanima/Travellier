import { describe, expect, it, vi } from "vitest";
import { createHttpClient } from "../api/index.js";
import { itineraryId } from "./itinerary-test-fixture.js";
import { createTripPostApi, type PostInput, type PostResponse } from "./trip-post-api.js";

const tripId = itineraryId(1);
const post = (n = 5, extra: Record<string, unknown> = {}): PostResponse => ({ id: itineraryId(n), tripId, authorId: itineraryId(20), description: "Texto",
  mapsUrl: null, activityId: null, parentPostId: null, transportId: null, createdAt: "2026-09-25T10:00:00.123Z", ...extra } as PostResponse);
const setup = (body: unknown, status = 200) => {
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status }));
  const client = createHttpClient({ baseUrl: "https://api.test", fetch, getAccessToken: async () => "token", onUnauthorized: vi.fn() });
  return { api: createTripPostApi(client), fetch };
};
const sent = (fetch: ReturnType<typeof vi.fn>) => ({ url: fetch.mock.calls[0][0] as string, method: fetch.mock.calls[0][1].method as string,
  body: fetch.mock.calls[0][1].body === undefined ? undefined : JSON.parse(fetch.mock.calls[0][1].body) });

describe("post HTTP adapter", () => {
  it("creates with exactly the content fields and never sends createdAt or dayId, even when forced", async () => {
    const { api, fetch } = setup({ post: post() }, 201);
    const forced = { description: "Texto", mapsUrl: "https://maps.test/x", createdAt: "2020-01-01T00:00:00.000Z", dayId: itineraryId(4) } as PostInput;
    expect(await api.create(tripId, forced)).toEqual({ ok: true, value: post() });
    expect(sent(fetch)).toEqual({ url: `https://api.test/trips/${tripId}/posts`, method: "POST",
      body: { description: "Texto", mapsUrl: "https://maps.test/x" } });
  });
  it("updates sending only the changed fields", async () => {
    const { api, fetch } = setup({ post: post(5, { description: null }) });
    expect((await api.update(tripId, itineraryId(5), { description: null })).ok).toBe(true);
    expect(sent(fetch)).toEqual({ url: `https://api.test/trips/${tripId}/posts/${itineraryId(5)}`, method: "PATCH", body: { description: null } });
  });
  it("never sends publication date or day on update either", async () => {
    const { api, fetch } = setup({ post: post() });
    await api.update(tripId, itineraryId(5), { description: "x", createdAt: "2020-01-01T00:00:00.000Z", dayId: itineraryId(4) } as PostInput);
    expect(sent(fetch).body).toEqual({ description: "x" });
  });
  it("creates with the link fields and still drops createdAt and dayId", async () => {
    const { api, fetch } = setup({ post: post() }, 201);
    const forced = { description: "Texto", parentPostId: itineraryId(8), activityId: itineraryId(9), transportId: itineraryId(10),
      createdAt: "2020-01-01T00:00:00.000Z", dayId: itineraryId(4) } as PostInput;
    await api.create(tripId, forced);
    expect(sent(fetch)).toEqual({ url: `https://api.test/trips/${tripId}/posts`, method: "POST",
      body: { description: "Texto", parentPostId: itineraryId(8), activityId: itineraryId(9), transportId: itineraryId(10) } });
  });
  it("updates sending explicit null links, never createdAt or dayId", async () => {
    const { api, fetch } = setup({ post: post() });
    const forced = { parentPostId: itineraryId(8), activityId: null, transportId: null, createdAt: "2020-01-01T00:00:00.000Z", dayId: itineraryId(4) } as PostInput;
    await api.update(tripId, itineraryId(5), forced);
    expect(sent(fetch)).toEqual({ url: `https://api.test/trips/${tripId}/posts/${itineraryId(5)}`, method: "PATCH",
      body: { parentPostId: itineraryId(8), activityId: null, transportId: null } });
  });
  it("omits undefined link fields but keeps null ones", async () => {
    const { api, fetch } = setup({ post: post() });
    await api.update(tripId, itineraryId(5), { parentPostId: null, activityId: undefined, transportId: undefined, description: undefined });
    expect(sent(fetch).body).toEqual({ parentPostId: null });
  });
  it("accepts a valid response with extra fields and a legacy dayId", async () => {
    const value = post(5, { dayId: itineraryId(4), likes: 3, context: {} });
    const { api } = setup({ post: value });
    expect(await api.create(tripId, { description: "Texto" })).toEqual({ ok: true, value: post() });
  });
  it("tolerates absent link fields as null", async () => {
    const value: Record<string, unknown> = { ...post() };
    delete value.activityId; delete value.parentPostId; delete value.transportId;
    const { api } = setup({ post: value });
    expect(await api.create(tripId, { description: "Texto" })).toEqual({ ok: true, value: post() });
  });
  it.each([
    ["another tripId", { tripId: itineraryId(2) }], ["a malformed createdAt", { createdAt: "ayer" }],
    ["a numeric description", { description: 4 }], ["a missing authorId", { authorId: undefined }], ["a malformed link", { activityId: "x" }],
  ])("rejects a response with %s as a server failure", async (_name, override) => {
    const { api } = setup({ post: post(5, override) });
    expect(await api.create(tripId, { description: "Texto" })).toEqual({ ok: false, error: { kind: "server" } });
  });
  it("keeps validation fields from a 422", async () => {
    const { api } = setup({ error: { code: "ValidationError", message: "x", fields: [{ field: "mapsUrl", code: "invalid", message: "Link inválido" }] } }, 422);
    expect(await api.create(tripId, { mapsUrl: "x" })).toEqual({ ok: false, error: { kind: "validation", fields: [{ field: "mapsUrl", code: "invalid", message: "Link inválido" }] } });
  });
  it.each([[404, "not-found"], [401, "unauthorized"], [403, "forbidden"]])("maps HTTP %i to %s", async (status, kind) => {
    const { api } = setup({}, status);
    expect(await api.update(tripId, itineraryId(5), { description: "x" })).toEqual({ ok: false, error: { kind } });
  });
  it("maps a network failure", async () => {
    const client = createHttpClient({ baseUrl: "https://api.test", fetch: vi.fn().mockRejectedValue(new Error("down")), getAccessToken: async () => "t", onUnauthorized: vi.fn() });
    expect(await createTripPostApi(client).create(tripId, { description: "x" })).toEqual({ ok: false, error: { kind: "network" } });
  });
  it("lists preserving the received order and requests the trip posts", async () => {
    const values = [post(7), post(5), post(6)];
    const { api, fetch } = setup({ posts: values });
    expect(await api.list(tripId)).toEqual({ ok: true, value: values });
    expect(sent(fetch)).toMatchObject({ url: `https://api.test/trips/${tripId}/posts`, method: "GET" });
  });
  it("fails the whole list when an item has no id or createdAt", async () => {
    const broken = { ...post(6) } as Record<string, unknown>; delete broken.createdAt;
    expect(await setup({ posts: [post(5), broken] }).api.list(tripId)).toEqual({ ok: false, error: { kind: "server" } });
    const noId = { ...post(6) } as Record<string, unknown>; delete noId.id;
    expect(await setup({ posts: [noId] }).api.list(tripId)).toEqual({ ok: false, error: { kind: "server" } });
  });
  const summary = (n: number, extra: Record<string, unknown> = {}) => ({ id: itineraryId(n), authorId: itineraryId(20), createdAt: "2026-09-26T10:00:00.000Z", description: `Texto ${n}`, ...extra });
  it("gets a post, validates it and keeps parent null and no children", async () => {
    const detail = { post: post(), parent: null, children: [], rootActivityId: null };
    const { api, fetch } = setup(detail);
    expect(await api.get(tripId, itineraryId(5))).toEqual({ ok: true, value: detail });
    expect(sent(fetch).url).toBe(`https://api.test/trips/${tripId}/posts/${itineraryId(5)}`);
    expect(await setup({ ...detail, post: post(5, { createdAt: 1 }) }).api.get(tripId, itineraryId(5))).toEqual({ ok: false, error: { kind: "server" } });
  });
  it("parses the immediate parent and the direct children, ignoring extra fields", async () => {
    const detail = { post: post(), parent: summary(3, { likes: 4 }), children: [summary(6, { description: null })], rootActivityId: itineraryId(8) };
    expect(await setup(detail).api.get(tripId, itineraryId(5))).toEqual({ ok: true, value: { post: post(), parent: summary(3), children: [summary(6, { description: null })], rootActivityId: itineraryId(8) } });
  });
  it("treats an absent children as empty and an absent parent as null", async () => {
    expect(await setup({ post: post(), rootActivityId: null }).api.get(tripId, itineraryId(5))).toEqual({ ok: true, value: { post: post(), parent: null, children: [], rootActivityId: null } });
  });
  it("orders the children newest first and by id descending on ties", async () => {
    const children = [summary(6, { createdAt: "2026-09-26T10:00:00.000Z" }), summary(7, { createdAt: "2026-09-27T10:00:00.000Z" }),
      summary(9, { createdAt: "2026-09-26T10:00:00.000Z" }), summary(8, { createdAt: "2026-09-25T10:00:00.000Z" })];
    const result = await setup({ post: post(), parent: null, children, rootActivityId: null }).api.get(tripId, itineraryId(5));
    expect(result.ok && result.value.children.map((child) => child.id)).toEqual([itineraryId(7), itineraryId(9), itineraryId(6), itineraryId(8)]);
  });
  it.each([
    ["a parent without a valid id", { parent: summary(3, { id: "x" }) }], ["a parent with a malformed createdAt", { parent: summary(3, { createdAt: "ayer" }) }],
    ["a parent with a numeric description", { parent: summary(3, { description: 4 }) }], ["a parent that is not an object", { parent: "x" }],
    ["a child with a malformed createdAt", { children: [summary(6, { createdAt: "ayer" })] }], ["a child without an id", { children: [summary(6, { id: undefined })] }],
    ["children that is not a list", { children: {} }], ["a child with a numeric description", { children: [summary(6, { description: 4 })] }],
  ])("rejects %s as a server failure without inventing content", async (_name, override) => {
    expect(await setup({ post: post(), parent: null, children: [], rootActivityId: null, ...override }).api.get(tripId, itineraryId(5))).toEqual({ ok: false, error: { kind: "server" } });
  });
  it("rejects a fetched post whose id differs from the requested one", async () => {
    expect(await setup({ post: post(6), parent: null, children: [], rootActivityId: null }).api.get(tripId, itineraryId(5))).toEqual({ ok: false, error: { kind: "server" } });
  });
});

describe("post HTTP adapter with a new activity", () => {
  const scheduledAt = "2026-09-25T15:00:00.000Z";
  const newActivity = { title: "Cena", scheduledAt, durationMinutes: 90 };
  const activity = (extra: Record<string, unknown> = {}) => ({ id: itineraryId(8), tripId, dayId: itineraryId(4), title: "Cena", description: null, mapsUrl: null,
    scheduledAt, durationMinutes: 90, createdAt: "2026-09-25T10:00:00.123Z", createdBy: itineraryId(20), ...extra });
  const participation = { id: itineraryId(50), tripId, activityId: itineraryId(8), userId: itineraryId(20), status: "going", updatedAt: "2026-09-25T12:00:00.123Z" };
  const confirmation = { confirmedConflicts: [{ activityId: itineraryId(9), reason: "overlap" as const, scheduledAt: "2026-09-25T14:30:00.000Z", durationMinutes: 60 }],
    confirmedActivity: { scheduledAt, durationMinutes: 90 } };
  const conflictBody = { error: { code: "ParticipationConflictError", message: "x", conflicts: confirmation.confirmedConflicts, activity: confirmation.confirmedActivity } };
  it("creates sending newActivity and the confirmation at the root, and returns activity and participation", async () => {
    const { api, fetch } = setup({ post: post(), activity: activity(), participation }, 201);
    const result = await api.create(tripId, { description: "Texto", newActivity }, confirmation);
    expect(result).toEqual({ ok: true, value: { ...post(), activity: activity(), participation } });
    expect(sent(fetch)).toEqual({ url: `https://api.test/trips/${tripId}/posts`, method: "POST",
      body: { description: "Texto", newActivity, confirmedConflicts: confirmation.confirmedConflicts, confirmedActivity: confirmation.confirmedActivity } });
  });
  it("never sends dayId inside newActivity or at the root, even when forced", async () => {
    const { api, fetch } = setup({ post: post(), activity: activity(), participation }, 201);
    await api.create(tripId, { description: "Texto", dayId: itineraryId(4), newActivity: { ...newActivity, dayId: itineraryId(4) } } as PostInput);
    expect(sent(fetch).body).toEqual({ description: "Texto", newActivity });
  });
  it("updates sending newActivity with an explicit null parent and the confirmation", async () => {
    const { api, fetch } = setup({ post: post(), activity: activity(), participation });
    const result = await api.update(tripId, itineraryId(5), { parentPostId: null, newActivity }, confirmation);
    expect(result).toEqual({ ok: true, value: { ...post(), activity: activity(), participation } });
    expect(sent(fetch)).toEqual({ url: `https://api.test/trips/${tripId}/posts/${itineraryId(5)}`, method: "PATCH",
      body: { parentPostId: null, newActivity, confirmedConflicts: confirmation.confirmedConflicts, confirmedActivity: confirmation.confirmedActivity } });
  });
  it("keeps a saved activity with participation null when the participation is invalid", async () => {
    const { api } = setup({ post: post(), activity: activity(), participation: { ...participation, status: "confirmed" } }, 201);
    expect(await api.create(tripId, { description: "Texto", newActivity })).toEqual({ ok: true, value: { ...post(), activity: activity(), participation: null } });
  });
  it.each([["missing", undefined], ["from another trip", activity({ tripId: itineraryId(2) })], ["without a title", activity({ title: "" })]])(
    "is a server failure when newActivity was sent and the response activity is %s", async (_name, value) => {
      expect(await setup({ post: post(), activity: value }, 201).api.create(tripId, { description: "Texto", newActivity })).toEqual({ ok: false, error: { kind: "server" } });
      expect(await setup({ post: post(), activity: value }).api.update(tripId, itineraryId(5), { newActivity })).toEqual({ ok: false, error: { kind: "server" } });
    });
  it("returns only the post when no newActivity was sent, ignoring any activity in the response", async () => {
    const result = await setup({ post: post(), activity: activity(), participation }, 201).api.create(tripId, { description: "Texto" });
    expect(result).toStrictEqual({ ok: true, value: post() });
  });
  it("maps a valid 409 to participation-conflict on create and update", async () => {
    expect(await setup(conflictBody, 409).api.create(tripId, { newActivity })).toEqual({ ok: false, error: { kind: "participation-conflict", confirmation } });
    expect(await setup(conflictBody, 409).api.update(tripId, itineraryId(5), { newActivity })).toEqual({ ok: false, error: { kind: "participation-conflict", confirmation } });
  });
  it("treats a malformed 409 as a server failure", async () => {
    expect(await setup({ error: { code: "ParticipationConflictError", message: "x", conflicts: [] } }, 409).api.create(tripId, { newActivity })).toEqual({ ok: false, error: { kind: "server" } });
  });
  it.each([["scheduledAt"], ["durationMinutes"]])("keeps the %s validation field with its code from a 422", async (field) => {
    const { api } = setup({ error: { code: "ValidationError", message: "x", fields: [{ field, code: "outside_window", message: "Fuera" }] } }, 422);
    expect(await api.create(tripId, { newActivity })).toEqual({ ok: false, error: { kind: "validation", fields: [{ field, code: "outside_window", message: "Fuera" }] } });
  });
  it("does not change the request without newActivity or confirmation", async () => {
    const { api, fetch } = setup({ post: post() }, 201);
    await api.create(tripId, { description: "Texto" });
    expect(sent(fetch).body).toEqual({ description: "Texto" });
  });
  describe("retry ids and request conflicts (T88)", () => {
    const ID = itineraryId(30), ACTIVITY_ID = itineraryId(31);
    const act = { title: "Cena", scheduledAt: "2026-09-25T20:00:00.000Z" };
    it("create sends the post id", async () => {
      const { api, fetch } = setup({ post: post() }, 201);
      await api.create(tripId, { id: ID, description: "Texto" });
      expect(sent(fetch).body).toEqual({ id: ID, description: "Texto" });
    });
    it("create ignores newActivity.id", async () => {
      const { api, fetch } = setup({ post: post(), activity: activity(), participation }, 201);
      await api.create(tripId, { id: ID, newActivity: { ...act, id: ACTIVITY_ID } });
      expect(sent(fetch).body).toEqual({ id: ID, newActivity: act });
    });
    it("update sends newActivity.id and never a post id", async () => {
      const { api, fetch } = setup({ post: post(), activity: activity(), participation });
      await api.update(tripId, itineraryId(5), { id: ID, newActivity: { ...act, id: ACTIVITY_ID } });
      expect(sent(fetch).body).toEqual({ newActivity: { id: ACTIVITY_ID, ...act } });
    });
    it("an id with an invalid format is not sent", async () => {
      const bad = { id: "ABCDEF0123456789ABCDEF01", description: "x", newActivity: { ...act, id: "nope" } } as PostInput;
      const created = setup({ post: post(), activity: activity(), participation }, 201);
      await created.api.create(tripId, bad);
      expect(sent(created.fetch).body).toEqual({ description: "x", newActivity: act });
      const updated = setup({ post: post(), activity: activity(), participation });
      await updated.api.update(tripId, itineraryId(5), bad);
      expect(sent(updated.fetch).body).toEqual({ description: "x", newActivity: act });
    });
    it("maps a 409 already_saved with its postId", async () => {
      const body = { error: { code: "PostRequestConflictError", message: "x", reason: "already_saved", postId: itineraryId(5) } };
      expect(await setup(body, 409).api.create(tripId, { id: ID, description: "x" })).toEqual({ ok: false, error: { kind: "already-saved", postId: itineraryId(5) } });
      expect(await setup(body, 409).api.update(tripId, itineraryId(5), { newActivity: act })).toEqual({ ok: false, error: { kind: "already-saved", postId: itineraryId(5) } });
    });
    it("maps an already_saved without a valid postId to already-saved without it", async () => {
      const body = { error: { code: "PostRequestConflictError", message: "x", reason: "already_saved", postId: "../x" } };
      expect(await setup(body, 409).api.create(tripId, { description: "x" })).toEqual({ ok: false, error: { kind: "already-saved" } });
    });
    it("maps the generic 409 (no reason) to a server failure with its code", async () => {
      const body = { error: { code: "PostRequestConflictError", message: "x" } };
      expect(await setup(body, 409).api.create(tripId, { id: ID, description: "x" })).toEqual({ ok: false, error: { kind: "server", code: "PostRequestConflictError" } });
    });
    it("keeps the participation conflict mapping when the body also carries a reason", async () => {
      expect(await setup(conflictBody, 409).api.create(tripId, { id: ID, newActivity })).toEqual({ ok: false, error: { kind: "participation-conflict", confirmation } });
    });
    it("keeps a 422 on the id as validation fields", async () => {
      const body = { error: { code: "ValidationError", message: "x", fields: [{ field: "id", code: "invalid", message: "m" }] } };
      expect(await setup(body, 422).api.create(tripId, { id: ID })).toEqual({ ok: false, error: { kind: "validation", fields: [{ field: "id", code: "invalid", message: "m" }] } });
    });
  });
});

describe("post HTTP adapter with an expense", () => {
  const stored = (extra: Record<string, unknown> = {}) => ({ id: itineraryId(40), tripId, postId: itineraryId(5), totalAmount: 25.5, currency: "ARS", breakdown: "cena",
    paidBy: null, payments: [], shares: [], createdAt: "2026-09-25T10:00:00.123Z", ...extra });
  it("creates sending only totalAmount, currency and breakdown, even when paidBy or non-list payments and shares are forced", async () => {
    const { api, fetch } = setup({ post: post(), expense: stored() }, 201);
    const forced = { description: "Texto", expense: { totalAmount: 25.5, currency: "ARS", breakdown: "cena", payments: null, shares: "x", paidBy: itineraryId(2) } } as unknown as PostInput;
    const result = await api.create(tripId, forced);
    expect(sent(fetch).body).toEqual({ description: "Texto", expense: { totalAmount: 25.5, currency: "ARS", breakdown: "cena" } });
    expect(result).toEqual({ ok: true, value: { ...post(), expense: { postId: itineraryId(5), totalAmount: 25.5, currency: "ARS", breakdown: "cena" } } });
  });
  it("updates with a merge-patch that keeps explicit null breakdown and never sends expense: null", async () => {
    const { api, fetch } = setup({ post: post(), expense: stored({ breakdown: null }) });
    await api.update(tripId, itineraryId(5), { expense: { breakdown: null } });
    expect(sent(fetch).body).toEqual({ expense: { breakdown: null } });
    await api.update(tripId, itineraryId(5), { description: "x", expense: null } as unknown as PostInput);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ description: "x" });
  });
  it("omits undefined keys of the expense", async () => {
    const { api, fetch } = setup({ post: post(), expense: stored() }, 201);
    await api.create(tripId, { expense: { totalAmount: 5, currency: "USD", breakdown: undefined } });
    expect(sent(fetch).body).toEqual({ expense: { totalAmount: 5, currency: "USD" } });
  });
  it.each([["missing", undefined], ["of another post", stored({ postId: itineraryId(6) })], ["with an invalid currency", stored({ currency: "BRL" })],
    ["with a non finite amount", stored({ totalAmount: "25" })]])("is a server failure when an expense was sent and the response expense is %s", async (_name, value) => {
    expect(await setup({ post: post(), expense: value }, 201).api.create(tripId, { expense: { totalAmount: 1, currency: "ARS" } })).toEqual({ ok: false, error: { kind: "server" } });
    expect(await setup({ post: post(), expense: value }).api.update(tripId, itineraryId(5), { expense: { totalAmount: 1 } })).toEqual({ ok: false, error: { kind: "server" } });
  });
  it("accepts a legacy expense without currency in the response", async () => {
    const result = await setup({ post: post(), expense: stored({ currency: null }) }).api.update(tripId, itineraryId(5), { expense: { currency: "EUR" } });
    expect(result.ok && result.value.expense?.currency).toBe(null);
  });
  it("does not require an expense in the response when none was sent", async () => {
    expect(await setup({ post: post() }, 201).api.create(tripId, { description: "Texto" })).toStrictEqual({ ok: true, value: post() });
    expect(await setup({ post: post(), expense: stored() }, 201).api.create(tripId, { description: "Texto" })).toStrictEqual({ ok: true, value: post() });
  });
  it("keeps the expense validation fields from a 422", async () => {
    const fields = [{ field: "expense.totalAmount", code: "invalid", message: "x" }, { field: "expense.payments[0].amount", code: "exceeds_total", message: "y" }];
    expect(await setup({ error: { code: "ValidationError", message: "x", fields } }, 422).api.update(tripId, itineraryId(5), { expense: { totalAmount: 1 } }))
      .toEqual({ ok: false, error: { kind: "validation", fields } });
  });
  it("maps a 409 ExpenseConflictError to a generic server failure", async () => {
    expect(await setup({ error: { code: "ExpenseConflictError", message: "x" } }, 409).api.create(tripId, { expense: { totalAmount: 1, currency: "ARS" } }))
      .toEqual({ ok: false, error: { kind: "server" } });
  });
});

describe("post HTTP adapter with payments and shares (T84)", () => {
  const stored = (extra: Record<string, unknown> = {}) => ({ id: itineraryId(40), tripId, postId: itineraryId(5), totalAmount: 25.5, currency: "ARS", breakdown: "cena",
    payments: [], shares: [], completeness: { status: "incomplete", reasons: ["missing_payments", "missing_shares"] }, formerMemberIds: [], createdAt: "2026-09-25T10:00:00.123Z", ...extra });
  const ana = itineraryId(30), beto = itineraryId(31);
  it("sends the rows with an allow list: only userId, unit and value, null value for remainder and excluded", async () => {
    const { api, fetch } = setup({ post: post(), expense: stored() }, 201);
    const forced = { totalAmount: 100, currency: "ARS", payments: [{ userId: ana, unit: "amount", value: 40, paidBy: beto, extra: 1 }],
      shares: [{ userId: ana, unit: "remainder", value: null, key: "k1" }, { userId: beto, unit: "excluded", value: null }, { userId: beto, unit: "percent", value: 10 }] };
    await api.create(tripId, { expense: forced } as unknown as PostInput);
    expect(sent(fetch).body).toEqual({ expense: { totalAmount: 100, currency: "ARS", payments: [{ userId: ana, unit: "amount", value: 40 }],
      shares: [{ userId: ana, unit: "remainder", value: null }, { userId: beto, unit: "excluded", value: null }, { userId: beto, unit: "percent", value: 10 }] } });
  });
  it("sends an empty list to clear it, but never null or a non-list", async () => {
    const { api, fetch } = setup({ post: post(), expense: stored() });
    await api.update(tripId, itineraryId(5), { expense: { payments: [], shares: [] } });
    expect(sent(fetch).body).toEqual({ expense: { payments: [], shares: [] } });
    await api.update(tripId, itineraryId(5), { description: "x", expense: { payments: null, shares: {} } } as unknown as PostInput);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ description: "x" });
  });
  const detail = (expense: unknown) => ({ post: post(), parent: null, children: [], rootActivityId: null, ...(expense === undefined ? {} : { expense }) });
  it("parses the full expense of the detail", async () => {
    const saved = stored({ payments: [{ userId: ana, unit: "percent", value: 100 }], shares: [{ userId: ana, unit: "remainder", value: null }, { userId: beto, unit: "amount", value: 5 }],
      completeness: { status: "incomplete", reasons: ["payments_not_covering_total"] }, formerMemberIds: [beto] });
    const result = await setup(detail(saved)).api.get(tripId, itineraryId(5));
    expect(result.ok && result.value.expense).toEqual({ postId: itineraryId(5), totalAmount: 25.5, currency: "ARS", breakdown: "cena",
      payments: [{ userId: ana, unit: "percent", value: 100 }], shares: [{ userId: ana, unit: "remainder", value: null }, { userId: beto, unit: "amount", value: 5 }],
      completeness: { status: "incomplete", reasons: ["payments_not_covering_total"] }, formerMemberIds: [beto] });
  });
  it("has no expense key when the server sends none and accepts a legacy null currency", async () => {
    const none = await setup(detail(undefined)).api.get(tripId, itineraryId(5));
    expect(none.ok && "expense" in none.value).toBe(false);
    const legacy = await setup(detail(stored({ currency: null }))).api.get(tripId, itineraryId(5));
    expect(legacy.ok && legacy.value.expense?.currency).toBe(null);
  });
  it.each([["null", null], ["of another post", stored({ postId: itineraryId(6) })], ["without payments", stored({ payments: undefined })],
    ["with a bad unit", stored({ payments: [{ userId: ana, unit: "remainder", value: null }] })],
    ["with a bad value", stored({ shares: [{ userId: ana, unit: "amount", value: "5" }] })],
    ["with a bad user", stored({ shares: [{ userId: "x", unit: "excluded", value: null }] })],
    ["with a remainder carrying a value", stored({ shares: [{ userId: ana, unit: "remainder", value: 3 }] })],
    ["with a bad completeness", stored({ completeness: { status: "x", reasons: [] } })],
    ["with bad former members", stored({ formerMemberIds: ["z"] })],
    ["with an invalid currency", stored({ currency: "BRL" })]])("keeps the detail but drops an expense that is %s, flagging it unreadable", async (_name, value) => {
    const result = await setup(detail(value)).api.get(tripId, itineraryId(5));
    expect(result.ok).toBe(true);
    expect(result.ok && "expense" in result.value).toBe(false);
    expect(result.ok && result.value.expenseUnreadable).toBe(true);
    expect(result.ok && result.value.post.id).toBe(itineraryId(5));
  });

});
