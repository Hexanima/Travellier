import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  "member.left": base(10, "member.left", { memberId: itineraryId(20), userId: itineraryId(21) }),
  "member.role_changed.admin": base(11, "member.role_changed", { userId: itineraryId(21), role: "admin" }),
  "member.role_changed.participant": base(12, "member.role_changed", { userId: itineraryId(21), role: "participant" }),
  "trip.ownership_transferred": base(13, "trip.ownership_transferred", { previousOwnerId: itineraryId(50) }),
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
/** An invalid or unknown notice is omitted (the page still loads) and registered with a fixed reason. */
const rejected = async (item: unknown, label = JSON.stringify(item)) => expect(await setup(page(item)).api.list({}), label).toEqual({ ok: true, value: { notifications: [], nextCursor: null } });
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => undefined); });
afterEach(() => { warn.mockRestore(); });

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

  it("parses the ten types, keeping the server order", async () => {
    const items = Object.values(valid).map((item, index) => ({ ...clone(item), id: itineraryId(2000 + index) }));
    const result = await setup({ notifications: items, nextCursor: "next" }).api.list({});
    expect(result).toEqual({ ok: true, value: { notifications: items, nextCursor: "next" } });
  });

  it("returns a rebuilt copy: the response objects never reach the UI", async () => {
    const item = clone(valid["comment.created"]);
    const result = await setup(page(item)).api.list({});
    expect(result.ok && result.value.notifications[0]).toEqual(item);
  });

  it("omits a type outside the ten known", async () => {
    for (const type of ["activity.deleted", "post.updated", "", "POST.CREATED", 5, null]) await rejected({ ...clone(valid["post.created"]), type }, String(type));
  });

  it("rejects ids that are not 24 hex, anywhere", async () => {
    const bad = [
      mutate("post.created", (i) => { i.id = "xyz"; }), mutate("post.created", (i) => { i.tripId = itineraryId(10).toUpperCase(); }), mutate("post.created", (i) => { i.actorId = "x"; }),
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

  it("parses the new member and ownership notices field by field", async () => {
    const keys: Key[] = ["member.left", "member.role_changed.admin", "member.role_changed.participant", "trip.ownership_transferred"];
    const result = await setup(page(...keys.map((key) => clone(valid[key])))).api.list({});
    expect(result).toEqual({ ok: true, value: { notifications: keys.map((key) => valid[key]), nextCursor: null } });
    expect(warn).not.toHaveBeenCalled();
  });

  it("omits new notices with an extra field, a bad id or an invalid role", async () => {
    const bad = [
      mutate("member.left", (i) => { payloadOf(i).extra = 1; }), mutate("member.left", (i) => { payloadOf(i).userId = "x"; }), mutate("member.left", (i) => { delete payloadOf(i).memberId; }),
      mutate("member.role_changed.admin", (i) => { payloadOf(i).role = "owner"; }), mutate("member.role_changed.admin", (i) => { payloadOf(i).role = null; }),
      mutate("member.role_changed.admin", (i) => { payloadOf(i).userId = "x"; }), mutate("member.role_changed.admin", (i) => { payloadOf(i).tripId = tripId; }),
      mutate("trip.ownership_transferred", (i) => { payloadOf(i).previousOwnerId = "x"; }), mutate("trip.ownership_transferred", (i) => { payloadOf(i).other = 1; }),
      mutate("trip.ownership_transferred", (i) => { payloadOf(i).previousOwnerId = null; }),
    ];
    for (const item of bad) await rejected(item);
  });

  it("accepts a null actorId on the new notices", async () => {
    const items = (["member.left", "member.role_changed.admin", "trip.ownership_transferred"] as Key[]).map((key, index) => ({ ...clone(valid[key]), id: itineraryId(4000 + index), actorId: null }));
    const result = await setup(page(...items)).api.list({});
    expect(result.ok && result.value.notifications).toHaveLength(3);
  });

  it("keeps the valid notices of a mixed page in order and the nextCursor, omitting unknown and invalid ones", async () => {
    const first = { ...clone(valid["post.created"]), id: itineraryId(5001) };
    const unknown = { ...clone(valid["post.created"]), id: itineraryId(5002), type: "activity.deleted" };
    const invalid = mutate("member.left", (i) => { i.id = itineraryId(5003); payloadOf(i).userId = "x"; });
    const last = { ...clone(valid["member.left"]), id: itineraryId(5004) };
    const result = await setup({ notifications: [first, unknown, invalid, last], nextCursor: "more" }).api.list({});
    expect(result).toEqual({ ok: true, value: { notifications: [first, last], nextCursor: "more" } });
  });

  it("returns an empty list with the nextCursor when every notice of the page is omitted", async () => {
    const result = await setup({ notifications: [{ ...clone(valid["post.created"]), type: "x" }, "junk", null], nextCursor: "more" }).api.list({});
    expect(result).toEqual({ ok: true, value: { notifications: [], nextCursor: "more" } });
  });

  it("registers one fixed-reason warning per omitted notice, never ids, payload or personal data", async () => {
    const unknown = { ...clone(valid["post.created"]), id: itineraryId(6001), type: "activity.deleted", payload: { title: "SECRETO-TITULO" } };
    const invalid = mutate("member.left", (i) => { i.id = itineraryId(6002); payloadOf(i).userId = "SECRETO-USER"; });
    await setup(page(unknown, invalid, "SECRETO-RAW")).api.list({});
    expect(warn).toHaveBeenCalledTimes(3);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("unknown_type");
    expect(logged).toContain("invalid_shape");
    for (const secret of ["SECRETO", itineraryId(6001), itineraryId(6002), tripId, itineraryId(21), itineraryId(50)]) expect(logged).not.toContain(secret);
  });

  it("truncates or drops the type in the log when it is not a short string", async () => {
    await setup(page({ ...clone(valid["post.created"]), type: "x".repeat(500) })).api.list({});
    expect(JSON.stringify(warn.mock.calls).length).toBeLessThan(300);
  });

  it("keeps the first of repeated ids and registers the repeated one", async () => {
    const result = await setup(page(valid["post.created"], valid["post.created"], valid["comment.created"])).api.list({});
    expect(result).toEqual({ ok: true, value: { notifications: [valid["post.created"], valid["comment.created"]], nextCursor: null } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(valid["post.created"].id);
  });

  it("rejects pages with more than 60 items and invalid nextCursor", async () => {
    const many = Array.from({ length: 61 }, (_, index) => ({ ...clone(valid["post.created"]), id: itineraryId(3000 + index) }));
    expect(await setup(page(...many)).api.list({})).toEqual(failure("server"));
    expect((await setup(page(...many.slice(0, 60))).api.list({})).ok).toBe(true);
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
