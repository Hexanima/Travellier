import { beforeEach, describe, expect, it, vi } from "vitest";
import * as domain from "../../index.js";
import type { Activity, ActivityParticipation, ItineraryDay, ObjectId, Post, PostExpense, PostPhoto, TripPostPort, TripPostScope, TripRole } from "../../index.js";

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
  let expenseRecords: PostExpense[];
  let photoRecords: PostPhoto[], listDaysCalls: number, days: ItineraryDay[], records: Post[], activities: Activity[], participations: ActivityParticipation[];
  let targets: Record<string, { id: ObjectId; tripId: ObjectId } | undefined>;
  let scope: TripPostScope, posts: TripPostPort, sequence: number;
  beforeEach(() => {
    role = "participant"; votingEnabled = false; tripExists = true; photoRecords = []; expenseRecords = []; listDaysCalls = 0; days = [day]; records = []; activities = []; participations = []; sequence = 20;
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
      listPhotos: async (id) => domain.ok(photoRecords.filter((p) => p.postId === id && p.tripId === tripId).sort((a, b) => a.order - b.order)),
      listPhotosByPosts: async (postIds) => domain.ok(photoRecords.filter((p) => postIds.includes(p.postId) && p.tripId === tripId).sort((a, b) => a.order - b.order)),
      findPhoto: async (id) => domain.ok(photoRecords.find((p) => p.id === id)),
      findPhotosByKeys: async (keys) => domain.ok(photoRecords.filter((p) => keys.includes(p.s3Key))),
      insertPhotos: async (photos) => { photoRecords.push(...photos); return domain.ok(undefined); },
      findExpense: async (id) => domain.ok(expenseRecords.find((e) => e.postId === id)),
      insertExpense: async (expense) => { expenseRecords.push(expense); return domain.ok(undefined); },
      updateExpenseFields: async (expense, fields) => {
        expenseRecords = expenseRecords.map((e) => e.id === expense.id ? { ...e, ...Object.fromEntries(fields.map((f) => [f, expense[f]])) } : e);
        return domain.ok(undefined);
      },
      insert: async (post) => { records.push(post); return domain.ok(undefined); },
      replace: async (post) => { records = records.map((p) => p.id === post.id ? post : p); return domain.ok(undefined); },
      insertActivity: async (activity) => { activities.push(activity); return domain.ok(undefined); },
      listActivities: async () => domain.ok(activities),
      listActivityIds: async () => domain.ok(activities.map((a) => a.id)),
      listTransportIds: async () => domain.ok(targets.transportId ? [targets.transportId.id] : []),
      listUserParticipations: async (userId) => domain.ok(participations.filter((p) => p.userId === userId)),
      saveParticipation: async (participation) => {
        const index = participations.findIndex((p) => p.activityId === participation.activityId && p.userId === participation.userId);
        if (index >= 0) participations[index] = participation; else participations.push(participation);
        return domain.ok(participation);
      },
    };
    posts = {
      withReadSnapshot: async (_, work) => work(scope),
      withTransaction: async (_, work) => {
        const before = structuredClone({ records, activities, participations, photoRecords, expenseRecords });
        const result = await work(scope);
        if (!result.ok) { expenseRecords = before.expenseRecords; photoRecords = before.photoRecords; records = before.records; activities = before.activities; participations = before.participations; }
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

  it("keeps validating the new activity day and window", async () => {
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

  describe("spontaneous activity with the author's plan (T58)", () => {
    const withDuration = { ...newActivity, durationMinutes: 60 };
    const seedActivity = (n: number, start: string, durationMinutes: number | null = 60, fields: Partial<Activity> = {}): Activity =>
      ({ id: id(n), tripId, dayId, title: `Plan ${n}`, description: null, mapsUrl: null, scheduledAt: new Date(start), durationMinutes,
        createdBy: id(9), createdAt: new Date("2026-10-01T00:00:00Z"), ...fields });
    const seedParticipation = (activityId: ObjectId, userId: ObjectId, status: ActivityParticipation["status"] = "going"): ActivityParticipation =>
      ({ id: id(Number.parseInt(userId.slice(-2), 16) * 256 + Number.parseInt(activityId.slice(-2), 16)), tripId, activityId, userId, status,
        updatedAt: new Date("2026-10-01T00:00:00Z") });
    const incompatibleA = id(50), incompatibleB = id(51), compatible = id(52), third = id(70);
    const seedAgenda = () => {
      activities = [seedActivity(50, "2026-09-25T12:30:00Z"), seedActivity(51, "2026-09-25T11:30:00Z"), seedActivity(52, "2026-09-25T16:00:00Z")];
      participations = [seedParticipation(incompatibleA, actor), seedParticipation(incompatibleB, actor), seedParticipation(compatible, actor),
        seedParticipation(incompatibleA, third)];
    };
    const confirmationFrom = (result: unknown) => {
      const value = (result as { value: { conflicts: { activityId: ObjectId; scheduledAt: Date; durationMinutes: number | null }[];
        activity: { scheduledAt: Date; durationMinutes: number | null } } }).value;
      return { confirmedConflicts: value.conflicts.map((c) => ({ activityId: c.activityId, scheduledAt: c.scheduledAt, durationMinutes: c.durationMinutes })),
        confirmedActivity: value.activity };
    };
    const snapshot = () => structuredClone({ records, activities, participations });

    it("saves activity, post and the author's going when there is no conflict", async () => {
      const result = await create({ newActivity: withDuration });
      expect(result).toMatchObject({ ok: true, value: { outcome: "created", post: { activityId: id(21), createdAt },
        activity: { id: id(21) }, participation: { activityId: id(21), userId: actor, status: "going", updatedAt: createdAt } } });
      expect(participations).toHaveLength(1);
      expect(participations[0]).toMatchObject({ tripId, activityId: id(21), userId: actor, status: "going", updatedAt: createdAt });
      expect(records).toHaveLength(1); expect(activities).toHaveLength(1);
    });

    it("keeps the automatic publication time when the activity records an earlier moment", async () => {
      const result = await create({ newActivity: withDuration });
      expect(result).toMatchObject({ ok: true, value: { post: { createdAt }, activity: { scheduledAt: newActivity.scheduledAt } } });
      expect(records[0]!.createdAt.getTime()).toBeGreaterThan(activities[0]!.scheduledAt.getTime());
    });

    it("derives the slice from the start when dayId is omitted and still validates an explicit one", async () => {
      expect(await domain.createTripPost.execute(dependencies(), { ...context, newActivity })).toMatchObject({ ok: true, value: { activity: { dayId } } });
      expect(await create({ dayId: id(97), newActivity })).toMatchObject({ ok: false, error: { issues: [{ field: "dayId", code: "not_found" }] } });
      days = [day, { ...day, id: id(30), tripId: id(99) }];
      expect(await create({ dayId: id(30), newActivity })).toMatchObject({ ok: false, error: { issues: [{ field: "dayId", code: "mismatch" }] } });
    });

    it("rejects an instant outside the windows or matching several slices when dayId is omitted", async () => {
      const bare = (fields: object) => domain.createTripPost.execute(dependencies(), { ...context, ...fields });
      expect(await bare({ newActivity: { ...newActivity, scheduledAt: new Date("2026-09-30T12:00:00Z") } }))
        .toMatchObject({ ok: false, error: { issues: [{ field: "scheduledAt", code: "outside_window" }] } });
      days = [day, { ...day, id: id(30), destinationId: id(31) }];
      expect(await bare({ newActivity })).toMatchObject({ ok: false, error: { issues: [{ field: "dayId", code: "ambiguous" }] } });
      expect(records).toEqual([]); expect(activities).toEqual([]); expect(participations).toEqual([]);
    });

    it("rejects a duration that exceeds the destination window without writing", async () => {
      const before = snapshot();
      expect(await create({ newActivity: { ...newActivity, durationMinutes: 600 } }))
        .toMatchObject({ ok: false, error: { issues: [{ field: "durationMinutes", code: "outside_window" }] } });
      expect(snapshot()).toEqual(before);
    });

    it("asks for confirmation on an agenda conflict without writing anything", async () => {
      seedAgenda(); const before = snapshot();
      const result = await create({ newActivity: withDuration });
      expect(result).toMatchObject({ ok: true, value: { outcome: "confirmation_required",
        conflicts: [{ activityId: incompatibleB }, { activityId: incompatibleA }],
        activity: { scheduledAt: newActivity.scheduledAt, durationMinutes: 60 } } });
      expect(snapshot()).toEqual(before);
    });

    it("saves everything with a valid confirmation: not_going on every incompatible plan, going on the new one, third parties untouched", async () => {
      seedAgenda();
      const confirmation = confirmationFrom(await create({ newActivity: withDuration }));
      sequence = 20;
      const result = await create({ newActivity: withDuration, ...confirmation });
      expect(result).toMatchObject({ ok: true, value: { outcome: "created", participation: { status: "going", activityId: id(21) } } });
      const status = (activityId: ObjectId, userId: ObjectId) => participations.find((p) => p.activityId === activityId && p.userId === userId)?.status;
      expect(status(incompatibleA, actor)).toBe("not_going"); expect(status(incompatibleB, actor)).toBe("not_going");
      expect(status(compatible, actor)).toBe("going"); expect(status(id(21), actor)).toBe("going");
      expect(status(incompatibleA, third)).toBe("going");
      expect(participations).toHaveLength(5);
      expect(records).toHaveLength(1); expect(activities).toHaveLength(4);
    });

    it("asks again when the conflict set or an incompatible participation changed after the confirmation", async () => {
      seedAgenda();
      const confirmation = confirmationFrom(await create({ newActivity: withDuration }));
      activities.push(seedActivity(53, "2026-09-25T12:45:00Z")); participations.push(seedParticipation(id(53), actor));
      let before = snapshot();
      expect(await create({ newActivity: withDuration, ...confirmation })).toMatchObject({ ok: true, value: { outcome: "confirmation_required" } });
      expect(snapshot()).toEqual(before);
      activities.pop(); participations.pop(); activities[0] = { ...activities[0]!, scheduledAt: new Date("2026-09-25T12:40:00Z") };
      before = snapshot();
      expect(await create({ newActivity: withDuration, ...confirmation })).toMatchObject({ ok: true, value: { outcome: "confirmation_required" } });
      expect(snapshot()).toEqual(before);
    });

    it("asks again when the confirmed schedule is not the requested one", async () => {
      seedAgenda();
      const confirmation = confirmationFrom(await create({ newActivity: withDuration }));
      for (const confirmedActivity of [{ ...confirmation.confirmedActivity, durationMinutes: 61 },
        { ...confirmation.confirmedActivity, scheduledAt: new Date("2026-09-25T12:00:00.457Z") }, undefined]) {
        const before = snapshot();
        expect(await create({ newActivity: withDuration, confirmedConflicts: confirmation.confirmedConflicts, confirmedActivity }))
          .toMatchObject({ ok: true, value: { outcome: "confirmation_required" } });
        expect(snapshot()).toEqual(before);
      }
    });

    it.each([{ confirmedConflicts: "x" }, { confirmedConflicts: [{ activityId: "no" }] }, { confirmedActivity: "x" }, { confirmedActivity: { scheduledAt: "no" } }])(
      "rejects a malformed confirmation %# without writing", async (fields) => {
        seedAgenda(); const before = snapshot();
        expect(await create({ newActivity: withDuration, ...fields })).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
        expect(snapshot()).toEqual(before);
      });

    it.each(["insert", "insertActivity", "saveParticipation"] as const)("rolls back everything when %s fails", async (method) => {
      seedAgenda();
      const confirmation = confirmationFrom(await create({ newActivity: withDuration })); const before = snapshot();
      scope[method] = async () => domain.err(new domain.UnknownError("failed"));
      expect(await create({ newActivity: withDuration, ...confirmation })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(snapshot()).toEqual(before);
    });

    it("rolls back the previous not_going and activity when the author's own going fails", async () => {
      seedAgenda();
      const confirmation = confirmationFrom(await create({ newActivity: withDuration })); const before = snapshot();
      const save = scope.saveParticipation; let calls = 0;
      scope.saveParticipation = async (p) => ++calls === 3 ? domain.err(new domain.UnknownError("failed")) : save(p);
      expect(await create({ newActivity: withDuration, ...confirmation })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(calls).toBe(3); expect(snapshot()).toEqual(before);
    });

    it("keeps rejecting an exclusive link: activityId and parentPostId with newActivity, but allows a transport", async () => {
      expect(await create({ newActivity, activityId: links.activityId })).toMatchObject({ ok: false, error: { issues: [{ field: "activityId", code: "conflict" }] } });
      expect(await create({ newActivity, parentPostId: links.parentPostId })).toMatchObject({ ok: false, error: { issues: [{ field: "parentPostId", code: "conflict" }] } });
      expect(snapshot()).toEqual({ records: [], activities: [], participations: [] });
      expect(await create({ newActivity, transportId: links.transportId })).toMatchObject({ ok: true, value: { post: { transportId: links.transportId } } });
    });

    describe("linkTripPostToNewActivity", () => {
      const link = (fields = {}) => {
        expect(domain.linkTripPostToNewActivity).toBeDefined();
        return domain.linkTripPostToNewActivity.execute(dependencies(), { ...context, postId, newActivity: withDuration, ...fields });
      };
      const later = new Date("2026-10-06T00:00:00Z");

      it("links an existing post to a new activity keeping its createdAt and marks the authenticated user as going", async () => {
        records = [seedPost({ createdAt: new Date("2026-09-01T00:00:00Z") })];
        const result = await link();
        expect(result).toMatchObject({ ok: true, value: { outcome: "linked", post: { id: postId, activityId: id(20), authorId: id(9),
          createdAt: new Date("2026-09-01T00:00:00Z") }, activity: { id: id(20), createdBy: actor, createdAt },
        participation: { userId: actor, activityId: id(20), status: "going" } } });
        expect(records[0]).toMatchObject({ activityId: id(20), createdAt: new Date("2026-09-01T00:00:00Z") });
        expect(participations).toHaveLength(1);
      });

      it("fails when the post has a parent unless the same edit clears it", async () => {
        records = [seedPost({ parentPostId: links.parentPostId })]; const before = snapshot();
        expect(await link()).toMatchObject({ ok: false, error: { issues: [{ field: "parentPostId", code: "conflict" }] } });
        expect(snapshot()).toEqual(before);
        sequence = 20;
        expect(await link({ parentPostId: null })).toMatchObject({ ok: true, value: { post: { parentPostId: null, activityId: id(20) } } });
      });

      it("rejects activityId together with newActivity and denies foreign or missing posts and outsiders", async () => {
        records = [seedPost()];
        expect(await link({ activityId: links.activityId })).toMatchObject({ ok: false, error: { issues: [{ field: "activityId", code: "conflict" }] } });
        expect(await link({ postId: id(98) })).toMatchObject({ ok: false, error: { tag: "PostNotFoundError" } });
        records = [seedPost({ tripId: id(99) })];
        expect(await link()).toMatchObject({ ok: false, error: { tag: "PostNotFoundError" } });
        records = [seedPost()]; role = undefined;
        expect(await link()).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
        expect(activities).toEqual([]);
      });

      it("applies the other editable fields and requires confirmation on conflicts without writing", async () => {
        records = [seedPost({ createdAt: later })]; seedAgenda(); const before = snapshot();
        const first = await link({ description: "Editado" });
        expect(first).toMatchObject({ ok: true, value: { outcome: "confirmation_required" } });
        expect(snapshot()).toEqual(before);
        expect(await link({ description: "Editado", ...confirmationFrom(first) })).toMatchObject({ ok: true,
          value: { outcome: "linked", post: { description: "Editado", createdAt: later } } });
        expect(participations.filter((p) => p.userId === actor && p.status === "not_going")).toHaveLength(2);
      });

      it.each(["replace", "insertActivity", "saveParticipation"] as const)("rolls back everything when %s fails", async (method) => {
        records = [seedPost()]; seedAgenda(); const before = snapshot();
        const confirmation = confirmationFrom(await link());
        scope[method] = async () => domain.err(new domain.UnknownError("failed"));
        expect(await link({ ...confirmation })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
        expect(snapshot()).toEqual(before);
      });
    });

    describe("photos of the post (T72)", () => {
      const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
      const key = (n: number, ext: "jpg" | "png" | "webp" = "jpg", user = actor, trip = tripId) => `trips/${trip}/photos/${user}/${uuid(n)}.${ext}`;
      const refs = (...ns: number[]) => ns.map((n) => ({ key: key(n) }));
      let heads: Record<string, { contentType: string | null; sizeBytes: number } | "fail" | undefined>;
      let headCalls: string[], inTransaction: boolean, headInsideTransaction: boolean, afterHead: (() => void) | undefined;
      let storage: domain.ObjectStoragePort;
      const stored = (n: number, order: number, postRef = postId, fields: Partial<PostPhoto> = {}): PostPhoto =>
        ({ id: id(300 + n), postId: postRef, tripId, uploaderId: actor, s3Key: key(n), order, uploadedAt: createdAt, ...fields });
      const uploaded = (...ns: number[]) => { for (const n of ns) heads[key(n)] = { contentType: "image/jpeg", sizeBytes: 1000 }; };
      beforeEach(() => {
        heads = {}; headCalls = []; inTransaction = false; headInsideTransaction = false; afterHead = undefined;
        const original = posts.withTransaction;
        posts = { ...posts, withTransaction: async (tripRef, work) => {
          inTransaction = true;
          try { return await original(tripRef, work); } finally { inTransaction = false; }
        } };
        storage = {
          createUploadTarget: async () => domain.err(new domain.UnknownError("unused")),
          createDownloadTarget: async () => domain.err(new domain.UnknownError("unused")),
          headObject: async ({ objectKey }) => {
            headCalls.push(objectKey);
            if (inTransaction) headInsideTransaction = true;
            const head = heads[objectKey];
            afterHead?.();
            return head === "fail" ? domain.err(new domain.UnknownError("s3 down")) : domain.ok(head);
          },
        };
      });
      const withStorage = () => ({ ...dependencies(), storage });
      const createWith = (fields = {}) => domain.createTripPost.execute(withStorage(), { ...context, ...fields });
      const updateWith = (fields = {}) => domain.updateTripPost.execute(withStorage(), { ...context, postId, ...fields });
      const linkWith = (fields = {}) => domain.linkTripPostToNewActivity.execute(withStorage(), { ...context, postId, newActivity: withDuration, ...fields });
      const state = () => structuredClone({ records, activities, participations, photoRecords });
      const failures = (result: { ok: boolean; error?: unknown }) =>
        result.ok ? [] : (result.error as domain.ValidationError).issues.map(({ field, code }) => `${field}/${code}`);

      it("creates the post with its photos in order, verifying each object before the transaction", async () => {
        uploaded(1, 2);
        const result = await createWith({ description: "Fotos", photos: refs(1, 2) });
        expect(result).toMatchObject({ ok: true, value: { outcome: "created", post: { id: id(20), description: "Fotos" },
          photos: [{ id: id(21), order: 1 }, { id: id(22), order: 2 }] } });
        expect(photoRecords).toEqual([
          { id: id(21), postId: id(20), tripId, uploaderId: actor, s3Key: key(1), order: 1, uploadedAt: createdAt },
          { id: id(22), postId: id(20), tripId, uploaderId: actor, s3Key: key(2), order: 2, uploadedAt: createdAt }]);
        expect(headCalls.sort()).toEqual([key(1), key(2)]);
        expect(headInsideTransaction, "headObject ran while the Trip lock was held").toBe(false);
      });

      it("answers exactly as before when no photos are sent and never touches the storage", async () => {
        const result = await createWith({ description: "Sin fotos" });
        expect(result.ok && Object.keys(result.value).sort()).toEqual(["outcome", "post"]);
        expect(headCalls).toEqual([]); expect(photoRecords).toEqual([]);
        records = [seedPost()];
        expect(await updateWith({ description: "Editado" })).toEqual(domain.ok(seedPost({ description: "Editado" })));
        expect(await update({ description: "Otro" })).toEqual(domain.ok(seedPost({ description: "Otro" })));
      });

      it("fails with UnknownError when photos arrive but no storage is configured", async () => {
        uploaded(1);
        expect(await domain.createTripPost.execute(dependencies(), { ...context, photos: refs(1) }))
          .toMatchObject({ ok: false, error: { tag: "UnknownError" } });
        records = [seedPost()];
        expect(await domain.updateTripPost.execute(dependencies(), { ...context, postId, photos: refs(1) }))
          .toMatchObject({ ok: false, error: { tag: "UnknownError" } });
        expect(state()).toEqual({ records: [seedPost()], activities: [], participations: [], photoRecords: [] });
      });

      it("lists every object problem by index and writes nothing", async () => {
        heads[key(2)] = { contentType: "image/jpeg", sizeBytes: 10 * 1024 * 1024 + 1 };
        heads[key(3)] = { contentType: "image/png", sizeBytes: 5 };
        uploaded(4);
        const insert = vi.spyOn(scope, "insertPhotos"), insertPost = vi.spyOn(scope, "insert");
        const result = await createWith({ photos: refs(1, 2, 3, 4) });
        expect(failures(result)).toEqual(["photos[0].key/not_uploaded", "photos[1].key/too_large", "photos[2].key/content_type_mismatch"]);
        expect(insert).not.toHaveBeenCalled(); expect(insertPost).not.toHaveBeenCalled();
        expect(state()).toEqual({ records: [], activities: [], participations: [], photoRecords: [] });
      });

      it.each([
        ["another user", { photos: [{ key: key(1, "jpg", id(77)) }] }, "photos[0].key/invalid"],
        ["another Trip", { photos: [{ key: key(1, "jpg", actor, id(88)) }] }, "photos[0].key/invalid"],
        ["a repeated key", { photos: refs(1, 1) }, "photos[1].key/duplicate"],
        ["an avatar key", { photos: [{ key: `avatars/${actor}/${uuid(1)}.jpg` }] }, "photos[0].key/invalid"],
        ["a malformed list", { photos: "x" }, "photos/invalid"],
        ["too many photos", { photos: refs(...Array.from({ length: 11 }, (_, i) => i + 1)) }, "photos/too_many"],
      ])("rejects %s before any storage call", async (_, fields, expected) => {
        uploaded(1);
        expect(failures(await createWith(fields))).toEqual([expected]);
        expect(headCalls).toEqual([]);
        expect(state()).toEqual({ records: [], activities: [], participations: [], photoRecords: [] });
      });

      it("writes nothing when the storage check fails for another reason than a missing object", async () => {
        uploaded(1); heads[key(2)] = "fail";
        expect(await createWith({ photos: refs(1, 2) })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
        expect(state()).toEqual({ records: [], activities: [], participations: [], photoRecords: [] });
      });

      it("revalidates membership under the lock: a member expelled between the object check and the save gets 404 and no photos", async () => {
        uploaded(1);
        afterHead = () => { role = undefined; };
        expect(await createWith({ photos: refs(1) })).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
        records = [seedPost()]; role = "participant"; afterHead = () => { role = undefined; };
        expect(await updateWith({ photos: refs(1) })).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
        expect(photoRecords).toEqual([]);
      });

      it("answers 404 to a non-member (outsider or former member) with valid photos without calling the storage", async () => {
        uploaded(1); role = undefined; records = [seedPost()];
        const before = state();
        expect(await createWith({ photos: refs(1) })).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
        expect(await updateWith({ photos: refs(1) })).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
        expect(await linkWith({ photos: refs(1) })).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
        expect(headCalls).toEqual([]); expect(state()).toEqual(before);
      });

      it("answers 404 (not 500) to a non-member when no storage is configured", async () => {
        role = undefined; records = [seedPost()];
        expect(await domain.createTripPost.execute(dependencies(), { ...context, photos: refs(1) })).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
        expect(await domain.updateTripPost.execute(dependencies(), { ...context, postId, photos: refs(1) })).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
        expect(await domain.linkTripPostToNewActivity.execute(dependencies(), { ...context, postId, newActivity: withDuration, photos: refs(1) }))
          .toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
      });

      it("adds no snapshot read when the save carries no photos", async () => {
        const snapshot = vi.spyOn(posts, "withReadSnapshot");
        await createWith({ description: "Sin fotos" });
        records = [seedPost()];
        await updateWith({ description: "Editado" });
        expect(snapshot).not.toHaveBeenCalled();
      });

      it("treats the same key retried in the same post as a no-op and never duplicates or reorders", async () => {
        records = [seedPost()]; uploaded(1, 2);
        const first = await updateWith({ photos: refs(1, 2) });
        const again = await updateWith({ photos: refs(2, 1) });
        const expected = { ...seedPost(), photos: [{ id: id(20), order: 1 }, { id: id(21), order: 2 }] };
        expect(first).toEqual(domain.ok(expected));
        expect(again).toEqual(domain.ok(expected));
        expect(photoRecords.map((p) => [p.s3Key, p.order])).toEqual([[key(1), 1], [key(2), 2]]);
      });

      it("rejects a key already registered in another post with PhotoConflictError and writes nothing", async () => {
        records = [seedPost()]; uploaded(1, 2);
        photoRecords = [stored(1, 1, id(50))];
        const before = state();
        expect(await updateWith({ photos: refs(2, 1) })).toMatchObject({ ok: false, error: { tag: "PhotoConflictError" } });
        expect(await createWith({ photos: refs(1) })).toMatchObject({ ok: false, error: { tag: "PhotoConflictError" } });
        expect(state()).toEqual(before);
      });

      it("answers 409 to the retry of a POST that did save, never duplicating photos", async () => {
        uploaded(1);
        expect(await createWith({ photos: refs(1) })).toMatchObject({ ok: true });
        expect(await createWith({ photos: refs(1) })).toMatchObject({ ok: false, error: { tag: "PhotoConflictError" } });
        expect(records).toHaveLength(1); expect(photoRecords).toHaveLength(1);
      });

      it("does not write photos when the agenda needs confirmation and saves them with the confirmation", async () => {
        seedAgenda(); uploaded(1);
        const before = state();
        const insert = vi.spyOn(scope, "insertPhotos");
        const first = await createWith({ newActivity: withDuration, photos: refs(1) });
        expect(first).toMatchObject({ ok: true, value: { outcome: "confirmation_required" } });
        expect(insert).not.toHaveBeenCalled(); expect(state()).toEqual(before);
        sequence = 20;
        expect(await createWith({ newActivity: withDuration, photos: refs(1), ...confirmationFrom(first) }))
          .toMatchObject({ ok: true, value: { outcome: "created", photos: [{ order: 1 }] } });
        expect(photoRecords).toHaveLength(1);
      });

      it("accepts a PATCH with only photos without touching the post fields", async () => {
        records = [seedPost({ description: "Intacta", activityId: links.activityId })]; uploaded(1);
        const replace = vi.spyOn(scope, "replace");
        expect(await updateWith({ photos: refs(1) })).toEqual(domain.ok({ ...seedPost({ description: "Intacta", activityId: links.activityId }),
          photos: [{ id: id(20), order: 1 }] }));
        expect(replace).not.toHaveBeenCalled();
        expect(records).toEqual([seedPost({ description: "Intacta", activityId: links.activityId })]);
      });

      it("keeps rejecting a PATCH without editable fields or photos", async () => {
        records = [seedPost()];
        expect(await updateWith()).toMatchObject({ ok: false, error: { issues: [{ field: "post", code: "required" }] } });
        expect(await updateWith({ photos: [] })).toMatchObject({ ok: false, error: { issues: [{ field: "photos", code: "invalid" }] } });
      });

      it("appends after the existing photos with contiguous order and caps the post at 10", async () => {
        records = [seedPost()]; uploaded(3, 4, 20, 21);
        photoRecords = [stored(1, 1), stored(2, 2)];
        expect(await updateWith({ photos: refs(3, 4) })).toMatchObject({ ok: true, value: { photos: [
          { id: id(301), order: 1 }, { id: id(302), order: 2 }, { id: id(20), order: 3 }, { id: id(21), order: 4 }] } });
        expect(photoRecords.map((p) => p.order)).toEqual([1, 2, 3, 4]);
        photoRecords = Array.from({ length: 9 }, (_, i) => stored(i + 1, i + 1));
        const before = state();
        expect(failures(await updateWith({ photos: refs(20, 21) }))).toEqual(["photos/too_many"]);
        expect(state()).toEqual(before);
        expect(await updateWith({ photos: refs(20) })).toMatchObject({ ok: true, value: { photos: expect.arrayContaining([{ id: id(22), order: 10 }]) } });
      });

      it("denies a PATCH to a missing post or a former member without writing photos", async () => {
        uploaded(1);
        expect(await updateWith({ photos: refs(1) })).toMatchObject({ ok: false, error: { tag: "PostNotFoundError" } });
        records = [seedPost()]; role = undefined;
        expect(await updateWith({ photos: refs(1) })).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
        expect(photoRecords).toEqual([]);
      });

      it("adds photos while linking the post to a new activity and rolls everything back when saving them fails", async () => {
        records = [seedPost()]; uploaded(1);
        expect(await linkWith({ photos: refs(1) })).toMatchObject({ ok: true, value: { outcome: "linked", photos: [{ id: id(21), order: 1 }] } });
        expect(photoRecords).toHaveLength(1);
        records = [seedPost()]; photoRecords = []; activities = []; participations = []; sequence = 20; uploaded(2);
        const before = state();
        scope.insertPhotos = async () => domain.err(new domain.UnknownError("failed"));
        expect(await linkWith({ photos: refs(2) })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
        expect(state()).toEqual(before);
      });

      it("rolls back the new post and activity when the photo insert fails on creation", async () => {
        uploaded(1);
        scope.insertPhotos = async () => domain.err(new domain.UnknownError("failed"));
        expect(await createWith({ newActivity: withDuration, photos: refs(1) })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
        expect(state()).toEqual({ records: [], activities: [], participations: [], photoRecords: [] });
      });

      describe("expense of the post (T79)", () => {
        const expense = { totalAmount: 1500.5, currency: "ARS", breakdown: "agua 5000" };
        const full = () => structuredClone({ ...state(), expenseRecords });
        const empty = { records: [], activities: [], participations: [], photoRecords: [], expenseRecords: [] };
        const stored = (fields: Record<string, unknown> = {}): PostExpense => ({ id: id(70), tripId, postId, totalAmount: 100, currency: "USD",
          breakdown: "viejo", createdAt: new Date("2026-01-01T00:00:00Z"), ...fields }) as PostExpense;
        const writers = () => (["insert", "replace", "insertActivity", "insertPhotos", "insertExpense", "updateExpenseFields", "saveParticipation"] as const)
          .map((method) => vi.spyOn(scope, method));
        const calls = (spies: ReturnType<typeof writers>) => spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0);

        it("creates the post and its expense with the server id and the post publication time", async () => {
          const result = await createWith({ description: "Cena", expense });
          expect(result).toEqual(domain.ok({ outcome: "created", post: seedPost({ id: id(20), authorId: actor, description: "Cena", mapsUrl: null }),
            expense: { id: id(21), tripId, postId: id(20), ...expense, createdAt } }));
          expect(expenseRecords).toEqual([{ id: id(21), tripId, postId: id(20), ...expense, createdAt }]);
        });

        it("writes the expense after the post, and answers exactly as before without an expense", async () => {
          const insert = vi.spyOn(scope, "insert"), insertExpense = vi.spyOn(scope, "insertExpense"), find = vi.spyOn(scope, "findExpense");
          expect(await createWith({ expense })).toMatchObject({ ok: true });
          expect(insert.mock.invocationCallOrder[0]).toBeLessThan(insertExpense.mock.invocationCallOrder[0]!);
          insert.mockClear(); insertExpense.mockClear(); find.mockClear(); expenseRecords = []; records = [seedPost()];
          const plain = await createWith({ description: "Sin gasto" });
          expect(plain.ok && Object.keys(plain.value).sort()).toEqual(["outcome", "post"]);
          expect(await updateWith({ description: "Editado" })).toEqual(domain.ok(seedPost({ description: "Editado" })));
          expect(find).not.toHaveBeenCalled(); expect(insertExpense).not.toHaveBeenCalled(); expect(expenseRecords).toEqual([]);
        });

        it("saves post, new activity, participation, photos and expense in a single transaction", async () => {
          uploaded(1);
          const transaction = vi.spyOn(posts, "withTransaction");
          const result = await createWith({ newActivity: withDuration, photos: refs(1), expense });
          expect(result).toMatchObject({ ok: true, value: { outcome: "created", photos: [{ order: 1 }],
            expense: { postId: id(20), ...expense, createdAt } } });
          expect(transaction).toHaveBeenCalledTimes(1);
          const saved = full();
          expect(saved.records).toHaveLength(1); expect(saved.activities).toHaveLength(1); expect(saved.participations).toHaveLength(1);
          expect(saved.photoRecords).toHaveLength(1); expect(saved.expenseRecords).toHaveLength(1);
        });

        it("does not write the expense when the agenda needs confirmation and saves it with the confirmation", async () => {
          seedAgenda();
          const before = full(), spies = writers();
          const first = await createWith({ newActivity: withDuration, expense });
          expect(first).toMatchObject({ ok: true, value: { outcome: "confirmation_required" } });
          expect(calls(spies)).toBe(0); expect(full()).toEqual(before);
          sequence = 20;
          expect(await createWith({ newActivity: withDuration, expense, ...confirmationFrom(first) }))
            .toMatchObject({ ok: true, value: { outcome: "created", expense: { totalAmount: 1500.5 } } });
          expect(expenseRecords).toHaveLength(1);
          records = [seedPost()]; expenseRecords = []; sequence = 20;
          vi.restoreAllMocks();
          const spiesLink = writers(), beforeLink = full();
          expect(await linkWith({ expense })).toMatchObject({ ok: true, value: { outcome: "confirmation_required" } });
          expect(calls(spiesLink)).toBe(0); expect(full()).toEqual(beforeLink);
        });

        it("accepts a PATCH with only the expense without touching the post, stamping the expense with now()", async () => {
          records = [seedPost({ description: "Intacta" })];
          const replace = vi.spyOn(scope, "replace");
          expect(await updateWith({ expense })).toEqual(domain.ok({ ...seedPost({ description: "Intacta" }),
            expense: { id: id(20), tripId, postId, ...expense, createdAt } }));
          expect(replace).not.toHaveBeenCalled();
          expect(records).toEqual([seedPost({ description: "Intacta" })]);
          expect(expenseRecords).toEqual([{ id: id(20), tripId, postId, ...expense, createdAt }]);
        });

        it("links the post to a new activity and saves its expense together", async () => {
          records = [seedPost()]; uploaded(1);
          expect(await linkWith({ expense, photos: refs(1) })).toMatchObject({ ok: true, value: { outcome: "linked", photos: [{ order: 1 }],
            expense: { postId, totalAmount: 1500.5, currency: "ARS" } } });
          expect(expenseRecords).toHaveLength(1);
          expect(activities).toHaveLength(1);
        });

        it("completes a legacy expense by $set of only the present fields and never inserts a second record", async () => {
          const legacy = { ...stored({ currency: null, breakdown: null }), paidBy: id(33), payments: [{ userId: id(33) }] } as PostExpense;
          expenseRecords = [legacy]; records = [seedPost()];
          const insertExpense = vi.spyOn(scope, "insertExpense"), update = vi.spyOn(scope, "updateExpenseFields");
          const result = await updateWith({ expense: { currency: "EUR" } });
          expect(result).toMatchObject({ ok: true, value: { expense: { id: id(70), currency: "EUR", totalAmount: 100, createdAt: legacy.createdAt } } });
          expect(insertExpense).not.toHaveBeenCalled();
          expect(update).toHaveBeenCalledTimes(1);
          expect(update.mock.calls[0]![1]).toEqual(["currency"]);
          expect(expenseRecords).toEqual([{ ...legacy, currency: "EUR" }]);
        });

        it("merges a partial update over the stored expense and clears the breakdown with null", async () => {
          expenseRecords = [stored()]; records = [seedPost()];
          expect(await updateWith({ expense: { totalAmount: 250 } })).toMatchObject({ ok: true, value: { expense: { totalAmount: 250, currency: "USD", breakdown: "viejo" } } });
          expect(await updateWith({ expense: { breakdown: null } })).toMatchObject({ ok: true, value: { expense: { totalAmount: 250, breakdown: null } } });
          expect(expenseRecords).toEqual([stored({ totalAmount: 250, breakdown: null })]);
        });

        it("needs a currency after the merge when completing a legacy expense: none is invented", async () => {
          expenseRecords = [stored({ currency: null })]; records = [seedPost()];
          const before = full();
          expect(failures(await updateWith({ expense: { breakdown: "x" } }))).toEqual(["expense.currency/required"]);
          expect(full()).toEqual(before);
        });

        it("rejects an expense without total or currency when the post has none", async () => {
          expect(failures(await createWith({ expense: { currency: "ARS" } }))).toEqual(["expense.totalAmount/required"]);
          expect(failures(await createWith({ expense: { totalAmount: 5 } }))).toEqual(["expense.currency/required"]);
          expect(full()).toEqual(empty);
        });

        it.each([
          ["a non-positive total", { totalAmount: 0, currency: "ARS" }, "expense.totalAmount/invalid"],
          ["a currency outside the catalog", { totalAmount: 5, currency: "BRL" }, "expense.currency/invalid"],
          ["payments", { totalAmount: 5, currency: "ARS", payments: [] }, "expense.payments/unsupported"],
          ["shares", { totalAmount: 5, currency: "ARS", shares: [] }, "expense.shares/unsupported"],
          ["paidBy", { totalAmount: 5, currency: "ARS", paidBy: id(2) }, "expense.paidBy/unsupported"],
          ["null", null, "expense/invalid"], ["an empty object", {}, "expense/invalid"], ["a list", [], "expense/invalid"], ["text", "10", "expense/invalid"],
        ])("rejects %s and writes nothing on create, link or update", async (_, bad, expected) => {
          uploaded(1); records = [];
          const spies = writers();
          expect(failures(await createWith({ newActivity: withDuration, photos: refs(1), expense: bad }))).toEqual([expected]);
          records = [seedPost()];
          expect(failures(await linkWith({ photos: refs(1), expense: bad }))).toEqual([expected]);
          expect(failures(await updateWith({ description: "Editado", expense: bad }))).toEqual([expected]);
          expect(calls(spies)).toBe(0);
          expect(full()).toEqual({ ...empty, records: [seedPost()] });
        });

        it.each(["insertExpense", "updateExpenseFields"] as const)("rolls back everything when %s fails", async (method) => {
          uploaded(1); scope[method] = async () => domain.err(new domain.UnknownError("failed"));
          if (method === "insertExpense") {
            expect(await createWith({ newActivity: withDuration, photos: refs(1), expense })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
            expect(full()).toEqual(empty);
            records = [seedPost()];
            expect(await linkWith({ photos: refs(1), expense })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
            expect(full()).toEqual({ ...empty, records: [seedPost()] });
          } else {
            expenseRecords = [stored()]; records = [seedPost()];
            const before = full();
            expect(await updateWith({ description: "Editado", photos: refs(1), expense: { totalAmount: 9 } })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
            expect(full()).toEqual(before);
          }
        });

        it("answers 404 to a non-member before validating or writing anything, even with an invalid expense", async () => {
          role = undefined; records = [seedPost()];
          const spies = writers(), before = full();
          for (const bad of [expense, { totalAmount: 0 }]) {
            expect(await createWith({ expense: bad })).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
            expect(await updateWith({ expense: bad })).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
            expect(await linkWith({ expense: bad })).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
          }
          expect(calls(spies)).toBe(0); expect(full()).toEqual(before);
        });

        it("answers 404 for a missing post and rejects a PATCH with nothing to edit", async () => {
          expect(await updateWith({ expense })).toMatchObject({ ok: false, error: { tag: "PostNotFoundError" } });
          records = [seedPost()];
          expect(await updateWith()).toMatchObject({ ok: false, error: { issues: [{ field: "post", code: "required" }] } });
          expect(expenseRecords).toEqual([]);
        });

        it("fails with UnknownError when an expense arrives without id and clock", async () => {
          records = [seedPost()];
          expect(await domain.updateTripPost.execute({ posts }, { ...context, postId, expense })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
          expect(expenseRecords).toEqual([]);
        });

        it("lets any current member (admin or participant) edit the expense of any post", async () => {
          for (const memberRole of ["admin", "participant"] as const) {
            role = memberRole; expenseRecords = [stored()]; records = [seedPost({ authorId: id(99) })];
            expect(await updateWith({ expense: { totalAmount: 7 } })).toMatchObject({ ok: true, value: { expense: { totalAmount: 7 } } });
          }
        });
      });
    });
  });
});
