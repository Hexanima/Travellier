import { describe, expect, it, vi } from "vitest";
import { createHttpClient } from "../api/index.js";
import { itineraryId } from "../trips/itinerary-test-fixture.js";
import { createTripNotificationApi } from "./trip-notification-api.js";

const tripId = itineraryId(1);
const at = "2026-11-10T10:00:00.000Z";
const base = (n: number, type: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ id: itineraryId(1000 + n), type, tripId, actorId: itineraryId(50), payload, createdAt: at, ...extra });
const valid = {
  "post.created": base(1, "post.created", { postId: itineraryId(10), actorId: itineraryId(50), activityId: itineraryId(11) }),
  "post.created.free": base(2, "post.created", { postId: itineraryId(10), actorId: itineraryId(50), activityId: null }),
  "activity.created": base(3, "activity.created", { activityId: itineraryId(11), actorId: itineraryId(50), scheduledAt: at, durationMinutes: 60 }),
  "activity.created.open": base(4, "activity.created", { activityId: itineraryId(11), actorId: itineraryId(50), scheduledAt: at, durationMinutes: null }),
  "activity.updated": base(5, "activity.updated", { activityId: itineraryId(11), actorId: itineraryId(50), changedFields: ["title", "scheduledAt"] }),
  "activity.participant_unlinked": base(6, "activity.participant_unlinked", {
    activityId: itineraryId(11), reason: "schedule_conflict", changedFields: ["scheduledAt", "durationMinutes"], changedAt: at,
    newInterval: { startsAt: at, durationMinutes: 60, endsAt: "2026-11-10T11:00:00.000Z" },
    incompatibleActivities: [{ activityId: itineraryId(12), reason: "overlap", scheduledAt: at, durationMinutes: 30 }, { activityId: itineraryId(13), reason: "same_start", scheduledAt: at, durationMinutes: null }],
  }),
  "member.joined": base(7, "member.joined", { memberId: itineraryId(20), userId: itineraryId(21) }),
  "member.expelled": base(8, "member.expelled", { tripId }, { actorId: null }),
  "comment.created": base(9, "comment.created", { commentId: itineraryId(30), postId: itineraryId(10), actorId: itineraryId(50) }),
};
type Key = keyof typeof valid;
const setup = (body: unknown, status = 200) => {
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status }));
  const client = createHttpClient({ baseUrl: "https://api.test", fetch, getAccessToken: async () => "token", onUnauthorized: vi.fn() });
  return { api: createTripNotificationApi(client), fetch };
};
const page = (...items: unknown[]) => ({ notifications: items, nextCursor: null });
const failure = (kind: string, extra: Record<string, unknown> = {}) => ({ ok: false, error: { kind, ...extra } });
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const payloadOf = (item: unknown) => (item as { payload: Record<string, unknown> }).payload;
const mutate = (key: Key, mutation: (item: Record<string, unknown>) => void) => { const item = clone(valid[key]) as unknown as Record<string, unknown>; mutation(item); return item; };
const rejected = async (item: unknown, label = JSON.stringify(item)) => expect(await setup(page(item)).api.list({}), label).toEqual(failure("server"));

describe("trip notification adapter", () => {
  it("builds the query with limit and encoded cursor and omits what is undefined", async () => {
    const { api, fetch } = setup(page());
    await api.list({ limit: 30, cursor: "a+b/c=" });
    expect(fetch.mock.calls[0][0]).toBe("https://api.test/notifications?limit=30&cursor=a%2Bb%2Fc%3D");
    expect(fetch.mock.calls[0][1].method).toBe("GET");
    await api.list({});
    expect(fetch.mock.calls[1][0]).toBe("https://api.test/notifications");
    await api.list({ cursor: undefined, limit: 60 });
    expect(fetch.mock.calls[2][0]).toBe("https://api.test/notifications?limit=60");
  });

  it("parses the seven types, keeping the server order", async () => {
    const items = Object.values(valid).map((item, index) => ({ ...clone(item), id: itineraryId(2000 + index) }));
    const result = await setup({ notifications: items, nextCursor: "next" }).api.list({});
    expect(result).toEqual({ ok: true, value: { notifications: items, nextCursor: "next" } });
  });

  it("returns a rebuilt copy: the response objects never reach the UI", async () => {
    const item = clone(valid["comment.created"]);
    const result = await setup(page(item)).api.list({});
    expect(result.ok && result.value.notifications[0]).toEqual(item);
  });

  it("rejects a type outside the seven known as a server failure", async () => {
    for (const type of ["activity.deleted", "post.updated", "", "POST.CREATED", 5, null]) await rejected({ ...clone(valid["post.created"]), type }, String(type));
  });

  it("rejects ids that are not 24 hex, anywhere", async () => {
    const bad = [
      mutate("post.created", (i) => { i.id = "xyz"; }), mutate("post.created", (i) => { i.tripId = itineraryId(1).toUpperCase(); }), mutate("post.created", (i) => { i.actorId = "x"; }),
      mutate("post.created", (i) => { payloadOf(i).postId = "../etc"; }), mutate("post.created", (i) => { payloadOf(i).activityId = "x"; }), mutate("post.created", (i) => { payloadOf(i).actorId = 5; }),
      mutate("activity.created", (i) => { payloadOf(i).activityId = `${itineraryId(11)}0`; }), mutate("comment.created", (i) => { payloadOf(i).commentId = "z"; }),
      mutate("member.joined", (i) => { payloadOf(i).memberId = "z"; }), mutate("member.joined", (i) => { payloadOf(i).userId = null; }),
      mutate("member.expelled", (i) => { payloadOf(i).tripId = "z"; }),
      mutate("activity.participant_unlinked", (i) => { (payloadOf(i).incompatibleActivities as Record<string, unknown>[])[0]!.activityId = "x"; }),
    ];
    for (const item of bad) await rejected(item);
  });

  it("rejects dates that are not ISO UTC with milliseconds", async () => {
    const bad = ["2026-11-10T10:00:00Z", "2026-11-10T10:00:00.000+00:00", "2026-11-10", "2026-02-31T10:00:00.000Z", "ayer", 5, null];
    for (const value of bad) {
      await rejected({ ...clone(valid["post.created"]), createdAt: value }, `createdAt ${String(value)}`);
      await rejected(mutate("activity.created", (i) => { payloadOf(i).scheduledAt = value; }), `scheduledAt ${String(value)}`);
      await rejected(mutate("activity.participant_unlinked", (i) => { payloadOf(i).changedAt = value; }), `changedAt ${String(value)}`);
      await rejected(mutate("activity.participant_unlinked", (i) => { (payloadOf(i).newInterval as Record<string, unknown>).startsAt = value; }), `startsAt ${String(value)}`);
      await rejected(mutate("activity.participant_unlinked", (i) => { (payloadOf(i).incompatibleActivities as Record<string, unknown>[])[0]!.scheduledAt = value; }), `incompatible ${String(value)}`);
      if (value !== null) await rejected(mutate("activity.participant_unlinked", (i) => { (payloadOf(i).newInterval as Record<string, unknown>).endsAt = value; }), `endsAt ${String(value)}`);
    }
  });

  it("rejects invalid changedFields", async () => {
    const updated = (changedFields: unknown) => mutate("activity.updated", (i) => { payloadOf(i).changedFields = changedFields; });
    const unlinked = (changedFields: unknown) => mutate("activity.participant_unlinked", (i) => { payloadOf(i).changedFields = changedFields; });
    for (const fields of [[], ["x"], ["title", "title"], "title", null, [5], ["scheduledAt", "id"]]) await rejected(updated(fields));
    // The unlinked event only knows the schedule fields.
    for (const fields of [[], ["title"], ["scheduledAt", "scheduledAt"], ["mapsUrl"]]) await rejected(unlinked(fields));
    expect((await setup(page(unlinked(["durationMinutes"]))).api.list({})).ok).toBe(true);
    expect((await setup(page(updated(["description", "mapsUrl", "durationMinutes"]))).api.list({})).ok).toBe(true);
  });

  it("rejects a payload shaped as another type, with missing or extra properties", async () => {
    const items = [
      { ...clone(valid["post.created"]), type: "comment.created" },
      mutate("post.created", (i) => { payloadOf(i).title = "Secreto"; }),
      mutate("activity.created", (i) => { delete payloadOf(i).durationMinutes; }),
      { ...clone(valid["post.created"]), userId: itineraryId(9) },
      { ...clone(valid["post.created"]), payload: null },
      mutate("activity.participant_unlinked", (i) => { payloadOf(i).reason = "other"; }),
      mutate("activity.participant_unlinked", (i) => { (payloadOf(i).incompatibleActivities as Record<string, unknown>[])[0]!.reason = "other"; }),
      mutate("activity.participant_unlinked", (i) => { (payloadOf(i).incompatibleActivities as Record<string, unknown>[])[0]!.title = "x"; }),
      mutate("activity.participant_unlinked", (i) => { payloadOf(i).incompatibleActivities = "x"; }),
      mutate("activity.participant_unlinked", (i) => { (payloadOf(i).newInterval as Record<string, unknown>).extra = 1; }),
      mutate("activity.created", (i) => { payloadOf(i).durationMinutes = 0; }),
      mutate("activity.created", (i) => { payloadOf(i).durationMinutes = 1.5; }),
    ];
    for (const item of items) await rejected(item);
  });

  it("accepts member.expelled only with its tripId, matching the notice and without actor", async () => {
    const items = [
      mutate("member.expelled", (i) => { payloadOf(i).userId = itineraryId(9); }),
      { ...clone(valid["member.expelled"]), payload: {} },
      mutate("member.expelled", (i) => { payloadOf(i).tripId = itineraryId(2); }),
      { ...clone(valid["member.expelled"]), actorId: itineraryId(50) },
    ];
    for (const item of items) await rejected(item);
  });

  it("rejects pages with more than 60 items, repeated ids and invalid nextCursor", async () => {
    const many = Array.from({ length: 61 }, (_, index) => ({ ...clone(valid["post.created"]), id: itineraryId(3000 + index) }));
    expect(await setup(page(...many)).api.list({})).toEqual(failure("server"));
    expect((await setup(page(...many.slice(0, 60))).api.list({})).ok).toBe(true);
    expect(await setup(page(valid["post.created"], valid["post.created"])).api.list({})).toEqual(failure("server"));
    for (const nextCursor of ["", 5, undefined, {}]) expect(await setup({ notifications: [], nextCursor }).api.list({}), String(nextCursor)).toEqual(failure("server"));
    for (const body of [null, [], "x", { nextCursor: null }, { notifications: {}, nextCursor: null }]) expect(await setup(body).api.list({}), JSON.stringify(body)).toEqual(failure("server"));
  });

  it("maps 401 and 422 and does not echo the payload in errors", async () => {
    expect(await setup({ error: { code: "Unauthorized", message: "SECRETO" } }, 401).api.list({})).toEqual(failure("unauthorized"));
    const invalid = await setup({ error: { code: "ValidationError", message: "SECRETO", fields: [{ field: "limit", code: "invalid", message: "Límite inválido" }] } }, 422).api.list({});
    expect(invalid).toEqual(failure("validation", { fields: [{ field: "limit", code: "invalid", message: "Límite inválido" }] }));
    expect(await setup({ error: { code: "X", message: "SECRETO" } }, 500).api.list({})).toEqual(failure("server"));
    const leaked = JSON.stringify(await setup(page({ ...clone(valid["post.created"]), type: "evil", payload: { title: "SECRETO-TITULO" } })).api.list({}));
    expect(leaked).not.toContain("SECRETO");
  });
});
