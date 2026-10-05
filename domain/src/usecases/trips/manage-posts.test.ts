import { beforeEach, describe, expect, it } from "vitest";
import * as domain from "../../index.js";
import type { Activity, ItineraryDay, ObjectId, Post, TripPostPort, TripPostScope, TripRole } from "../../index.js";

const id = (n: number): ObjectId => {
  const parsed = domain.createObjectId(n.toString(16).padStart(24, "0"));
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const tripId = id(1), actor = id(2), dayId = id(3), postId = id(4);
const links = { activityId: id(5), parentPostId: id(6), transportId: id(7) };
const createdAt = new Date("2026-10-04T12:00:00.789Z");
const day: ItineraryDay = { id: dayId, tripId, destinationId: id(8), type: "activity", order: 1,
  date: new Date("2026-09-25T00:00:00Z"), startsAt: new Date("2026-09-25T10:00:00.123Z"), endsAt: new Date("2026-09-25T18:00:00.789Z") };
const context = { tripId, authenticatedUserId: actor };
const newActivity = { title: "Cena", scheduledAt: new Date("2026-09-25T12:00:00.456Z") };
const seedPost = (fields: Partial<Post> = {}): Post => ({ id: postId, tripId, dayId, authorId: id(9), createdAt,
  description: "Recuerdo", mapsUrl: "maps", activityId: null, parentPostId: null, transportId: null, ...fields });

describe("Trip post use cases", () => {
  let role: TripRole | undefined, votingEnabled: boolean, tripExists: boolean;
  let days: ItineraryDay[], records: Post[], activities: Activity[];
  let targets: Record<string, { id: ObjectId; tripId: ObjectId } | undefined>;
  let scope: TripPostScope, posts: TripPostPort, sequence: number;
  beforeEach(() => {
    role = "participant"; votingEnabled = false; tripExists = true; days = [day]; records = []; activities = []; sequence = 20;
    targets = Object.fromEntries(Object.entries(links).map(([field, id]) => [field, { id, tripId }]));
    scope = {
      findMemberRole: async () => domain.ok(role),
      findTrip: async () => domain.ok(tripExists ? { id: tripId, votingEnabled } : undefined),
      listDays: async () => domain.ok(days),
      findActivity: async (id) => domain.ok(activities.find((a) => a.id === id) ?? (targets.activityId?.id === id ? targets.activityId : undefined)),
      findTransport: async (id) => domain.ok(targets.transportId?.id === id ? targets.transportId : undefined),
      find: async (id) => domain.ok(records.find((p) => p.id === id) ?? (targets.parentPostId?.id === id ? seedPost(targets.parentPostId) : undefined)),
      list: async () => domain.ok(records),
      insert: async (post) => { records.push(post); return domain.ok(undefined); },
      replace: async (post) => { records = records.map((p) => p.id === post.id ? post : p); return domain.ok(undefined); },
      insertActivity: async (activity) => { activities.push(activity); return domain.ok(undefined); },
    };
    posts = {
      withReadSnapshot: async (_, work) => work(scope),
      withTransaction: async (_, work) => {
        const before = structuredClone({ records, activities });
        const result = await work(scope);
        if (!result.ok) { records = before.records; activities = before.activities; }
        return result;
      },
    };
  });
  const dependencies = () => ({ posts, createId: () => id(sequence++), now: () => createdAt });
  const create = (fields = {}) => {
    expect(domain.createTripPost).toBeDefined();
    return domain.createTripPost.execute(dependencies(), { ...context, dayId, ...fields });
  };
  const update = (fields = {}) => {
    expect(domain.updateTripPost).toBeDefined();
    return domain.updateTripPost.execute(dependencies(), { ...context, postId, ...fields });
  };

  it.each(Array.from({ length: 8 }, (_, i) => i))("creates link combination %i with server metadata", async (mask) => {
    const selected = { activityId: mask & 1 ? links.activityId : null, parentPostId: mask & 2 ? links.parentPostId : null,
      transportId: mask & 4 ? links.transportId : null };
    expect(await create({ ...selected, authorId: id(99), id: id(99), createdAt: new Date(0), tripId }))
      .toMatchObject({ ok: true, value: { post: { id: id(20), tripId, dayId, authorId: actor, createdAt, description: null, mapsUrl: null, ...selected } } });
    expect(records).toHaveLength(1);
  });

  it.each(["admin", "participant"] as const)("allows %s to edit another author's post and preserves ownership", async (memberRole) => {
    role = memberRole; records = [seedPost()];
    expect(await update({ description: "Editado", mapsUrl: null, authorId: actor, createdAt: new Date(0), id: id(99) }))
      .toEqual(domain.ok(seedPost({ description: "Editado", mapsUrl: null })));
  });

  it.each(Object.keys(links) as (keyof typeof links)[])("adds, replaces and removes %s independently", async (field) => {
    records = [seedPost(links)];
    targets[field] = { id: id(10), tripId };
    expect(await update({ [field]: id(10) })).toEqual(domain.ok(seedPost({ ...links, [field]: id(10) })));
    expect(await update({ [field]: null })).toEqual(domain.ok(seedPost({ ...links, [field]: null })));
    targets[field] = { id: links[field], tripId };
    expect(await update({ [field]: links[field] })).toEqual(domain.ok(seedPost(links)));
  });

  it("removes all links and preserves omitted text", async () => {
    records = [seedPost(links)]; targets = {};
    expect(await update({ activityId: null, parentPostId: null, transportId: null })).toEqual(domain.ok(seedPost()));
  });

  it.each(Object.keys(links) as (keyof typeof links)[])("rejects missing and foreign %s without modifying any field", async (field) => {
    records = [seedPost(links)]; const before = structuredClone(records);
    for (const target of [undefined, { id: links[field], tripId: id(99) }]) {
      targets[field] = target;
      expect(await update({ description: "No", ...links })).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
      expect(records).toEqual(before);
      expect(await create(links)).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
      expect(records).toEqual(before);
    }
  });

  it("validates retained links and rejects self-reference", async () => {
    records = [seedPost(links)]; targets.transportId = undefined;
    expect(await update({ description: "No" })).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    records = [seedPost()];
    expect(await update({ parentPostId: postId })).toMatchObject({ ok: false, error: { issues: [{ field: "parentPostId", code: "self_reference" }] } });
    expect(records).toEqual([seedPost()]);
  });

  it.each(["createTripPost", "listTripPosts", "getTripPost", "updateTripPost"] as const)("denies outsiders and missing Trips for %s", async (operation) => {
    records = [seedPost()];
    for (const missing of ["member", "trip"]) {
      role = missing === "member" ? undefined : "participant"; tripExists = missing !== "trip";
      expect(domain[operation]).toBeDefined();
      expect(await domain[operation].execute(dependencies(), { ...context, dayId, postId, description: "No" }))
        .toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
      expect(records).toEqual([seedPost()]);
    }
  });

  it("hides foreign and missing posts, and scopes and orders the list", async () => {
    records = [seedPost({ tripId: id(99) })];
    expect(domain.getTripPost).toBeDefined();
    expect(await domain.getTripPost.execute(dependencies(), { ...context, postId })).toMatchObject({ ok: false, error: { tag: "PostNotFoundError" } });
    expect(await update({ description: "No" })).toMatchObject({ ok: false, error: { tag: "PostNotFoundError" } });
    records.push(seedPost({ id: id(11) }), seedPost({ id: id(10) }), seedPost({ id: id(12), createdAt: new Date(0) }));
    expect(await domain.listTripPosts.execute(dependencies(), context)).toEqual(domain.ok([records[3], records[2], records[1]]));
    expect(await domain.getTripPost.execute(dependencies(), { ...context, postId: id(98) })).toMatchObject({ ok: false, error: { tag: "PostNotFoundError" } });
  });

  it.each(["activity", "transit_out", "transit_return", "arrival"] as const)("allows %s days regardless of publication time", async (type) => {
    days = [{ ...day, type }]; expect(await create()).toMatchObject({ ok: true });
  });

  it("rejects absent or foreign days and empty edits", async () => {
    records = [seedPost()];
    expect(await update()).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    for (const values of [[], [{ ...day, tripId: id(99) }]]) {
      days = values;
      expect(await create()).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
      expect(await update({ description: "No" })).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
      expect(records).toEqual([seedPost()]);
    }
  });

  it.each([false, true])("creates an activity and its first post atomically with voting=%s", async (enabled) => {
    votingEnabled = enabled;
    const result = await create({ newActivity });
    expect(result).toMatchObject({ ok: true, value: { post: { activityId: id(21), authorId: actor },
      activity: { id: id(21), createdBy: actor, createdAt, scheduledAt: newActivity.scheduledAt, status: enabled ? "proposed" : "confirmed" } } });
    expect(records).toHaveLength(1); expect(activities).toHaveLength(1);
  });

  it("rejects ambiguous activity input and invalid schedules before persisting", async () => {
    for (const fields of [{ newActivity, activityId: links.activityId },
      { newActivity: { ...newActivity, scheduledAt: new Date(0) } }, { newActivity: { ...newActivity, title: " " } },
      { newActivity, transportId: id(99) }]) {
      expect(await create(fields)).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
      expect(records).toEqual([]); expect(activities).toEqual([]);
    }
  });

  it.each(["insert", "insertActivity"] as const)("propagates %s failure and rolls back joint creation", async (method) => {
    scope[method] = async () => domain.err(new domain.UnknownError("failed"));
    expect(await create({ newActivity })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
    expect(records).toEqual([]); expect(activities).toEqual([]);
  });
});
