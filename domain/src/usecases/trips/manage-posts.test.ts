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
const seedPost = (fields: Partial<Post> = {}): Post => ({ id: postId, tripId, authorId: id(9), createdAt,
  description: "Recuerdo", mapsUrl: "maps", activityId: null, parentPostId: null, transportId: null, ...fields });

describe("Trip post use cases", () => {
  let role: TripRole | undefined, votingEnabled: boolean, tripExists: boolean;
  let listDaysCalls: number, days: ItineraryDay[], records: Post[], activities: Activity[];
  let targets: Record<string, { id: ObjectId; tripId: ObjectId } | undefined>;
  let scope: TripPostScope, posts: TripPostPort, sequence: number;
  beforeEach(() => {
    role = "participant"; votingEnabled = false; tripExists = true; listDaysCalls = 0; days = [day]; records = []; activities = []; sequence = 20;
    targets = Object.fromEntries(Object.entries(links).map(([field, id]) => [field, { id, tripId }]));
    scope = {
      findMemberRole: async () => domain.ok(role),
      findTrip: async () => domain.ok(tripExists ? { id: tripId, votingEnabled } : undefined),
      listDays: async () => { listDaysCalls++; return domain.ok(days); },
      findActivity: async (id) => domain.ok(activities.find((a) => a.id === id) ?? (targets.activityId?.id === id ? targets.activityId : undefined)),
      findTransport: async (id) => domain.ok(targets.transportId?.id === id ? targets.transportId : undefined),
      find: async (id) => domain.ok(records.find((p) => p.id === id) ?? (targets.parentPostId?.id === id ? seedPost(targets.parentPostId) : undefined)),
      list: async () => domain.ok(records),
      listChildren: async (id) => domain.ok(records.filter((p) => p.tripId === tripId && p.parentPostId === id)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))),
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

  it.each(Array.from({ length: 8 }, (_, i) => i).filter((mask) => !(mask & 2) || !(mask & 5)))("creates link combination %i with server metadata", async (mask) => {
    const selected = { activityId: mask & 1 ? links.activityId : null, parentPostId: mask & 2 ? links.parentPostId : null,
      transportId: mask & 4 ? links.transportId : null };
    expect(await create({ ...selected, authorId: id(99), id: id(99), createdAt: new Date(0), tripId }))
      .toMatchObject({ ok: true, value: { post: { id: id(20), tripId, authorId: actor, createdAt, description: null, mapsUrl: null, ...selected } } });
    expect(records).toHaveLength(1);
    expect(records[0]).not.toHaveProperty("dayId");
    expect(records[0]!.createdAt.getMilliseconds()).toBe(789);
    expect(listDaysCalls).toBe(0);
  });

  it("ignores a legacy dayId on create and keeps the server publication time", async () => {
    days = [];
    const result = await create({ dayId: id(99), createdAt: new Date(0) });
    expect(result).toMatchObject({ ok: true, value: { post: { createdAt } } });
    expect(records[0]).not.toHaveProperty("dayId");
  });

  it.each(["admin", "participant"] as const)("allows %s to edit another author's post and preserves ownership", async (memberRole) => {
    role = memberRole; records = [seedPost()];
    expect(await update({ description: "Editado", mapsUrl: null, authorId: actor, createdAt: new Date(0), id: id(99) }))
      .toEqual(domain.ok(seedPost({ description: "Editado", mapsUrl: null })));
    expect(records[0]!.createdAt.getMilliseconds()).toBe(789);
    expect(listDaysCalls).toBe(0);
  });

  it("does not make dayId editable and keeps a legacy day untouched", async () => {
    records = [seedPost({ dayId })];
    expect(await update({ dayId: id(99) })).toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "post", code: "required" }] } });
    expect(await update({ description: "Editado", dayId: id(99) })).toMatchObject({ ok: true, value: { description: "Editado", createdAt } });
  });

  it.each(Object.keys(links) as (keyof typeof links)[])("adds, replaces and removes %s independently", async (field) => {
    const base = field === "parentPostId" ? { parentPostId: links.parentPostId }
      : { activityId: links.activityId, transportId: links.transportId };
    const full = { activityId: null, parentPostId: null, transportId: null, ...base };
    records = [seedPost(full)];
    targets[field] = { id: id(10), tripId };
    expect(await update({ [field]: id(10) })).toEqual(domain.ok(seedPost({ ...full, [field]: id(10) })));
    expect(await update({ [field]: null })).toEqual(domain.ok(seedPost({ ...full, [field]: null })));
    targets[field] = { id: links[field], tripId };
    expect(await update({ [field]: links[field] })).toEqual(domain.ok(seedPost(full)));
  });

  it("rejects parent together with activity or transport on create without writing", async () => {
    for (const fields of [{ parentPostId: links.parentPostId, activityId: links.activityId },
      { parentPostId: links.parentPostId, transportId: links.transportId }, links]) {
      expect(await create(fields)).toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "parentPostId", code: "conflict" }] } });
      expect(records).toEqual([]);
    }
  });

  it("rejects adding a parent to a post with activity unless the same edit clears it", async () => {
    records = [seedPost({ activityId: links.activityId })];
    expect(await update({ parentPostId: links.parentPostId }))
      .toMatchObject({ ok: false, error: { issues: [{ field: "parentPostId", code: "conflict" }] } });
    expect(records).toEqual([seedPost({ activityId: links.activityId })]);
    expect(await update({ parentPostId: links.parentPostId, activityId: null }))
      .toEqual(domain.ok(seedPost({ parentPostId: links.parentPostId })));
  });

  describe("post chains", () => {
    const a = id(40), b = id(41), c = id(42), d = id(43), root = id(44);
    const chain = (extra: Post[] = []) => [seedPost({ id: root, activityId: links.activityId }),
      seedPost({ id: a, parentPostId: root, createdAt: new Date("2026-10-04T12:00:01Z") }),
      seedPost({ id: b, parentPostId: a, createdAt: new Date("2026-10-04T12:00:02Z") }),
      seedPost({ id: c, parentPostId: b, createdAt: new Date("2026-10-04T12:00:03Z") }), ...extra];
    const spy = () => {
      const calls = { replace: 0, insert: 0 };
      const replace = scope.replace, insert = scope.insert;
      scope.replace = async (post) => { calls.replace++; return replace(post); };
      scope.insert = async (post) => { calls.insert++; return insert(post); };
      return calls;
    };

    it.each([[root, c], [a, c], [a, b]])("rejects an indirect cycle when %# moves under a descendant", async (moved, parent) => {
      records = chain(); const before = structuredClone(records); const calls = spy();
      expect(await update({ postId: moved, parentPostId: parent, activityId: null }))
        .toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "parentPostId", code: "cycle" }] } });
      expect(calls).toEqual({ replace: 0, insert: 0 });
      expect(records).toEqual(before);
    });

    it("keeps self-reference as its own error", async () => {
      records = chain();
      expect(await update({ postId: b, parentPostId: b }))
        .toMatchObject({ ok: false, error: { issues: [{ field: "parentPostId", code: "self_reference" }] } });
    });

    it("accepts a branch under a non-descendant and unrelated moves", async () => {
      records = chain([seedPost({ id: d, parentPostId: root })]);
      expect(await update({ postId: d, parentPostId: c })).toMatchObject({ ok: true, value: { id: d, parentPostId: c } });
      expect(await update({ postId: c, parentPostId: null })).toMatchObject({ ok: true, value: { parentPostId: null } });
    });

    it("rejects a parent from another Trip or missing without writing", async () => {
      records = [...chain(), seedPost({ id: d, tripId: id(99) })]; const calls = spy();
      expect(await update({ postId: a, parentPostId: d }))
        .toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "parentPostId" }] } });
      expect(await update({ postId: a, parentPostId: id(97) }))
        .toMatchObject({ ok: false, error: { issues: [{ field: "parentPostId", code: "not_found" }] } });
      expect(calls.replace).toBe(0);
    });

    it("does not hang on a pre-existing corrupt cycle outside the edited post", async () => {
      records = [seedPost({ id: a, parentPostId: b }), seedPost({ id: b, parentPostId: a }), seedPost({ id: c })];
      expect(await update({ postId: c, parentPostId: a })).toMatchObject({ ok: true });
    });

    describe("technical depth limit", () => {
      const deep = (length: number) => Array.from({ length }, (_, i) =>
        seedPost({ id: id(1000 + i), parentPostId: i === 0 ? null : id(999 + i) }));
      const bottom = (length: number) => id(999 + length);

      it("rejects instead of hiding a cycle beyond the limit, without writing", async () => {
        records = deep(domain.MAX_POST_CHAIN_DEPTH + 5); const before = structuredClone(records); const calls = spy();
        expect(await update({ postId: id(1000), parentPostId: bottom(domain.MAX_POST_CHAIN_DEPTH + 5) }))
          .toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "parentPostId", code: "too_deep" }] } });
        expect(calls).toEqual({ replace: 0, insert: 0 });
        expect(records).toEqual(before);
      });

      it("still detects the cycle when the chain has exactly the maximum depth", async () => {
        records = deep(domain.MAX_POST_CHAIN_DEPTH);
        expect(await update({ postId: id(1000), parentPostId: bottom(domain.MAX_POST_CHAIN_DEPTH) }))
          .toMatchObject({ ok: false, error: { issues: [{ field: "parentPostId", code: "cycle" }] } });
      });

      it("accepts linking under a chain of exactly the maximum depth", async () => {
        records = [...deep(domain.MAX_POST_CHAIN_DEPTH), seedPost({ id: id(5000) })];
        expect(await update({ postId: id(5000), parentPostId: bottom(domain.MAX_POST_CHAIN_DEPTH) }))
          .toMatchObject({ ok: true });
      });

      it("keeps reads tolerant with a null root beyond the limit", async () => {
        records = deep(domain.MAX_POST_CHAIN_DEPTH + 5);
        expect(await domain.getTripPostChain.execute(dependencies(), { ...context, postId: bottom(domain.MAX_POST_CHAIN_DEPTH + 5) }))
          .toMatchObject({ ok: true, value: { rootActivityId: null } });
      });
    });

    it("returns parent, direct children newest first and the root activity", async () => {
      records = chain([seedPost({ id: d, parentPostId: a, createdAt: new Date("2026-10-04T12:00:09Z"), description: "rama" })]);
      expect(domain.getTripPostChain).toBeDefined();
      const result = await domain.getTripPostChain.execute(dependencies(), { ...context, postId: a });
      expect(result).toEqual(domain.ok({ post: records[1],
        parent: { id: root, authorId: id(9), createdAt, description: "Recuerdo" },
        children: [{ id: d, authorId: id(9), createdAt: new Date("2026-10-04T12:00:09Z"), description: "rama" },
          { id: b, authorId: id(9), createdAt: new Date("2026-10-04T12:00:02Z"), description: "Recuerdo" }],
        rootActivityId: links.activityId }));
    });

    it("returns null parent, no children and null root activity for an independent post", async () => {
      records = [seedPost()];
      expect(await domain.getTripPostChain.execute(dependencies(), { ...context, postId }))
        .toEqual(domain.ok({ post: seedPost(), parent: null, children: [], rootActivityId: null }));
    });

    it("resolves the root through a branch and tolerates a corrupt cycle with a null root", async () => {
      records = chain();
      expect(await domain.getTripPostChain.execute(dependencies(), { ...context, postId: c }))
        .toMatchObject({ ok: true, value: { rootActivityId: links.activityId, children: [] } });
      records = [seedPost({ id: a, parentPostId: b }), seedPost({ id: b, parentPostId: a })];
      expect(await domain.getTripPostChain.execute(dependencies(), { ...context, postId: a }))
        .toMatchObject({ ok: true, value: { rootActivityId: null } });
    });

    it("hides posts from another Trip and denies outsiders", async () => {
      records = [seedPost({ tripId: id(99) })];
      expect(await domain.getTripPostChain.execute(dependencies(), { ...context, postId }))
        .toMatchObject({ ok: false, error: { tag: "PostNotFoundError" } });
      records = [seedPost()]; role = undefined;
      expect(await domain.getTripPostChain.execute(dependencies(), { ...context, postId }))
        .toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    });
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
      expect(await domain[operation].execute(dependencies(), { ...context, postId, description: "No" }))
        .toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
      expect(records).toEqual([seedPost()]);
    }
  });

  it("lists by publication descending with a stable id-descending tie-break", async () => {
    const later = new Date("2026-10-05T00:00:00.001Z");
    records = [seedPost({ id: id(10) }), seedPost({ id: id(12) }), seedPost({ id: id(11), createdAt: later }),
      seedPost({ id: id(13), createdAt: new Date(0) }), seedPost({ id: id(14), tripId: id(99) })];
    const result = await domain.listTripPosts.execute(dependencies(), context);
    expect(result.ok && result.value.map((p) => p.id)).toEqual([id(11), id(12), id(10), id(13)]);
  });

  it("hides foreign and missing posts, and scopes and orders the list", async () => {
    records = [seedPost({ tripId: id(99) })];
    expect(domain.getTripPost).toBeDefined();
    expect(await domain.getTripPost.execute(dependencies(), { ...context, postId })).toMatchObject({ ok: false, error: { tag: "PostNotFoundError" } });
    expect(await update({ description: "No" })).toMatchObject({ ok: false, error: { tag: "PostNotFoundError" } });
    records.push(seedPost({ id: id(11) }), seedPost({ id: id(10) }), seedPost({ id: id(12), createdAt: new Date(0) }));
    expect(await domain.listTripPosts.execute(dependencies(), context)).toEqual(domain.ok([records[1], records[2], records[3]]));
    expect(await domain.getTripPost.execute(dependencies(), { ...context, postId: id(98) })).toMatchObject({ ok: false, error: { tag: "PostNotFoundError" } });
  });

  it.each([0, 1])("creates and edits without a matching itinerary day (%#)", async (variant) => {
    days = variant === 0 ? [] : [{ ...day, tripId: id(99) }]; records = [seedPost()];
    expect(await create()).toMatchObject({ ok: true });
    expect(await update({ description: "Nuevo" })).toMatchObject({ ok: true });
    expect(listDaysCalls).toBe(0);
  });

  it("rejects empty edits", async () => {
    records = [seedPost()];
    expect(await update()).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
  });

  it("keeps validating the new activity day and window until T58", async () => {
    days = [];
    expect(await create({ dayId, newActivity })).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(records).toEqual([]); expect(activities).toEqual([]);
  });

  it.each([false, true])("creates an activity and its first post atomically with voting=%s", async (enabled) => {
    votingEnabled = enabled;
    const result = await create({ dayId, newActivity });
    expect(result).toMatchObject({ ok: true, value: { post: { activityId: id(21), authorId: actor },
      activity: { id: id(21), createdBy: actor, createdAt, scheduledAt: newActivity.scheduledAt } } });
    expect(records).toHaveLength(1); expect(activities).toHaveLength(1);
    expect(activities[0]).not.toHaveProperty("status");
  });

  it("rejects ambiguous activity input and invalid schedules before persisting", async () => {
    for (const fields of [{ newActivity, activityId: links.activityId },
      { newActivity: { ...newActivity, scheduledAt: new Date(0) } }, { newActivity: { ...newActivity, title: " " } },
      { newActivity, transportId: id(99) }]) {
      expect(await create(fields)).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
      expect(records).toEqual([]); expect(activities).toEqual([]);
    }
  });

  it("creates a spontaneous activity with an optional duration and keeps millisecond precision", async () => {
    const result = await create({ newActivity: { ...newActivity, durationMinutes: 90 } });
    expect(result).toMatchObject({ ok: true, value: { activity: { scheduledAt: new Date("2026-09-25T12:00:00.456Z"),
      durationMinutes: 90 } } });
    expect(activities[0]).toMatchObject({ scheduledAt: new Date("2026-09-25T12:00:00.456Z"), durationMinutes: 90 });
    expect(domain.activityEndsAt(activities[0]!)).toEqual(new Date("2026-09-25T13:30:00.456Z"));
  });

  it("stores a spontaneous activity without duration as null", async () => {
    expect(await create({ newActivity })).toMatchObject({ ok: true, value: { activity: { durationMinutes: null } } });
  });

  it.each([0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 400])(
    "rejects a spontaneous activity duration %s without inserting the activity or post", async (durationMinutes) => {
      let writes = 0;
      scope.insert = async () => { writes++; return domain.ok(undefined); };
      scope.insertActivity = async () => { writes++; return domain.ok(undefined); };
      expect(await create({ newActivity: { ...newActivity, durationMinutes } }))
        .toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "durationMinutes" }] } });
      expect(writes).toBe(0);
    });

  it.each(["insert", "insertActivity"] as const)("propagates %s failure and rolls back joint creation", async (method) => {
    scope[method] = async () => domain.err(new domain.UnknownError("failed"));
    expect(await create({ newActivity })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
    expect(records).toEqual([]); expect(activities).toEqual([]);
  });
});
