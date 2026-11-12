import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { PostFixture } from "../../test/post-fixture.js";

// Explicit dates far from the real clock: PAST has always started, FUTURE never has (the exact limit uses a controlled clock).
const PAST = new Date("2020-06-10T00:00:00.000Z");
const FUTURE = new Date("2099-06-10T00:00:00.000Z");
const at = (base: Date, hour: number) => new Date(base.getTime() + hour * 3_600_000);

describe("leaving a Trip and the cleanup of future participations (T116)", () => {
  const f = new PostFixture();
  beforeAll(() => f.start("trip_leave"), 120_000);
  afterAll(() => f.stop());
  let pendingReleases: Array<() => void> = [];
  let launched: Array<Promise<unknown>> = [];
  afterEach(async () => {
    vi.useRealTimers();
    for (const release of pendingReleases) release();
    pendingReleases = [];
    await Promise.allSettled(launched);
    launched = [];
  });

  // O = owner (admin), B = admin, C = leaving participant, D = participant, X = outsider.
  let O: ObjectId, B: ObjectId, C: ObjectId, D: ObjectId, X: ObjectId, pastDay: ObjectId, futureDay: ObjectId;
  beforeEach(async () => {
    vi.restoreAllMocks();
    await f.reset();
    O = f.actor; B = new ObjectId(); C = new ObjectId(); D = new ObjectId(); X = new ObjectId();
    pastDay = new ObjectId(); futureDay = new ObjectId();
    // Private Trip: the detail of a public one is readable by non-members.
    await f.db.collection("trips").updateOne({ _id: f.trip }, { $set: { visibility: "private" } });
    await f.db.collection("tripMembers").updateOne({ tripId: f.trip, userId: O }, { $set: { role: "admin" } });
    await f.db.collection("tripMembers").insertMany([
      { tripId: f.trip, userId: B, role: "admin", joinedAt: new Date() },
      { tripId: f.trip, userId: C, role: "participant", joinedAt: new Date() },
      { tripId: f.trip, userId: D, role: "participant", joinedAt: new Date() },
    ]);
    for (const [_id, base] of [[pastDay, PAST], [futureDay, FUTURE]] as const) {
      await f.db.collection("itineraryDays").insertOne({ _id, tripId: f.trip, destinationId: f.destination, type: "activity", order: 2,
        date: base, startsAt: at(base, 8), endsAt: at(base, 20) });
    }
  });

  const call = (user: ObjectId, method: string, path: string, body?: unknown) =>
    f.request(method, `/trips/${f.trip}${path}`, body === undefined ? undefined : JSON.stringify(body), user);
  const leave = (user: ObjectId) => call(user, "POST", "/leave");
  const expel = (actor: ObjectId, target: ObjectId) => call(actor, "DELETE", `/members/${target}`);
  const transfer = (actor: ObjectId, target: ObjectId) => call(actor, "POST", "/transfer-ownership", { userId: target.toHexString() });

  const addActivity = async (day: ObjectId, scheduledAt: Date, durationMinutes: number | null = null) => {
    const _id = new ObjectId();
    await f.db.collection("activities").insertOne({ _id, tripId: f.trip, dayId: day, title: "Plan", description: null, mapsUrl: null,
      durationMinutes, scheduledAt, status: "confirmed", createdBy: O, createdAt: new Date() });
    return _id;
  };
  const marker = { reason: "schedule_conflict", changedFields: ["scheduledAt"], changedAt: new Date("2026-10-01T00:00:00.000Z") };
  const participate = async (activityId: ObjectId, userId: ObjectId, status: string, decisionRequired?: object) => {
    await f.db.collection("activityParticipations").insertOne({ tripId: f.trip, activityId, userId, status, updatedAt: new Date("2026-10-02T00:00:00.000Z"),
      ...(decisionRequired === undefined ? {} : { decisionRequired }) });
  };
  const held = async (user: ObjectId) => (await f.db.collection("activityParticipations").find({ tripId: f.trip, userId: user }).toArray()).map((p) => String(p.activityId)).sort();
  const sorted = (...ids: ObjectId[]) => ids.map(String).sort();
  const isMember = async (user: ObjectId) => (await f.db.collection("tripMembers").countDocuments({ tripId: f.trip, userId: user })) === 1;
  const owner = async () => (await f.db.collection("trips").findOne({ _id: f.trip }))?.ownerId;
  const fullSnapshot = () => Promise.all(["trips", "tripMembers", "activities", "activityParticipations", "outboxEvents"]
    .map((name) => f.db.collection(name).find().sort({ _id: 1 }).toArray()));
  const body = (response: { body: string }) => JSON.parse(response.body) as { error?: { code?: string } };

  /** C holds every status in the future (with marks) and one started plan; D and the owner hold plans too. */
  const scenario = async () => {
    const started = await addActivity(pastDay, at(PAST, 12));
    const going = await addActivity(futureDay, at(FUTURE, 12));
    const notGoing = await addActivity(futureDay, at(FUTURE, 13));
    const pending = await addActivity(futureDay, at(FUTURE, 14));
    const empty = await addActivity(futureDay, at(FUTURE, 15));
    await participate(started, C, "pending", marker); await participate(started, D, "going");
    await participate(going, C, "going"); await participate(going, D, "going"); await participate(going, O, "going");
    await participate(notGoing, C, "not_going"); await participate(pending, C, "pending", marker); await participate(pending, D, "not_going");
    return { started, going, notGoing, pending, empty };
  };

  it("lets a participant leave: membership out, future participations and marks deleted, started kept, nobody else touched", async () => {
    const plans = await scenario();
    const content = ["posts", "postPhotos", "comments", "postLikes", "commentLikes", "postExpenses"];
    for (const name of content) await f.db.collection(name).insertOne({ tripId: f.trip, userId: C, authorId: C, payerId: C, createdAt: new Date() });
    const contentBefore = await Promise.all(content.map((name) => f.db.collection(name).find().toArray()));
    const othersBefore = await f.db.collection("activityParticipations").find({ userId: { $ne: C } }).sort({ _id: 1 }).toArray();
    const activitiesBefore = await f.db.collection("activities").find().sort({ _id: 1 }).toArray();
    const eventsBefore = await f.db.collection("outboxEvents").countDocuments({});

    expect(await leave(C)).toEqual({ statusCode: 204, headers: {}, body: "" });

    expect(await isMember(C)).toBe(false);
    expect(await held(C)).toEqual(sorted(plans.started));
    expect(await f.db.collection("activityParticipations").findOne({ activityId: plans.started, userId: C })).toMatchObject({ status: "pending", decisionRequired: marker });
    expect(await f.db.collection("activityParticipations").find({ userId: { $ne: C } }).sort({ _id: 1 }).toArray()).toEqual(othersBefore);
    expect(await f.db.collection("activities").find().sort({ _id: 1 }).toArray()).toEqual(activitiesBefore);
    expect(await Promise.all(content.map((name) => f.db.collection(name).find().toArray()))).toEqual(contentBefore);
    // A voluntary leave notifies exactly the members who stay (T135), with ids only.
    const leftEvents = await f.db.collection("outboxEvents").find({ type: "member.left" }).sort({ _id: 1 }).toArray();
    expect(leftEvents.map((event) => String(event.userId)).sort()).toEqual(sorted(O, B, D));
    expect(leftEvents.every((event) => event.status === "pending" && String(event.actorId) === String(C) && String(event.payload.userId) === String(C))).toBe(true);
    expect(await f.db.collection("outboxEvents").countDocuments({})).toBe(eventsBefore + 3);
    // An activity left without participants stays listed.
    const listed = await call(D, "GET", "/activities");
    expect(listed.statusCode).toBe(200);
    expect((JSON.parse(listed.body) as { activities: Array<{ id: string }> }).activities.map((a) => a.id).sort()).toEqual(sorted(plans.started, plans.going, plans.notGoing, plans.pending, plans.empty));
    // The former member loses access to the whole Trip and receives no new notice.
    for (const path of ["", "/members", "/activities", "/posts"]) expect((await call(C, "GET", path)).statusCode, path).toBe(404);
    const created = await call(D, "POST", "/activities", { title: "Nuevo", dayId: futureDay.toHexString(), scheduledAt: at(FUTURE, 17).toISOString() });
    expect(created.statusCode).toBe(201);
    expect(await f.db.collection("outboxEvents").countDocuments({ userId: C })).toBe(0);
  }, 30_000);

  const inbox = async (user: ObjectId) => {
    const response = await f.request("GET", "/notifications", undefined, user);
    expect(response.statusCode, response.body).toBe(200);
    return (JSON.parse(response.body) as { notifications: { type: string; payload: Record<string, unknown> }[] }).notifications;
  };

  it("shows member.left to the members who stay through GET /notifications and nothing to the one who left", async () => {
    expect((await leave(C)).statusCode).toBe(204);
    for (const user of [O, B, D]) {
      const notices = (await inbox(user)).filter((notice) => notice.type === "member.left");
      expect(notices, String(user)).toHaveLength(1);
      expect(notices[0]?.payload).toMatchObject({ userId: C.toHexString() });
    }
    expect((await inbox(C)).filter((notice) => notice.type === "member.left")).toEqual([]);
    expect(await f.db.collection("outboxEvents").countDocuments({ userId: C })).toBe(0);
  }, 30_000);

  it("a retried leave does not duplicate the notices and a rejected owner leave emits none", async () => {
    expect((await leave(C)).statusCode).toBe(204);
    expect((await leave(C)).statusCode).toBe(404);
    expect(await f.db.collection("outboxEvents").countDocuments({ type: "member.left" })).toBe(3);
    expect((await leave(O)).statusCode).toBe(409);
    expect((await leave(X)).statusCode).toBe(404);
    expect(await f.db.collection("outboxEvents").countDocuments({ type: "member.left" })).toBe(3);
  }, 30_000);

  it("an expulsion produces only member.expelled and a later leave notifies just the members who stay, with no role or ownership notices", async () => {
    expect((await expel(B, D)).statusCode).toBe(204);
    const events = await f.db.collection("outboxEvents").find({}).toArray();
    expect(events.map((event) => [event.type, String(event.userId)])).toEqual([["member.expelled", String(D)]]);
    expect((await leave(C)).statusCode).toBe(204);
    expect((await f.db.collection("outboxEvents").find({ type: { $in: ["member.role_changed", "trip.ownership_transferred"] } }).toArray())).toEqual([]);
    expect((await f.db.collection("outboxEvents").find({ type: "member.left" }).toArray()).map((event) => String(event.userId)).sort()).toEqual(sorted(O, B));
  }, 30_000);

  it("answers 404 to a second attempt, to a non-member and to a missing Trip, writing nothing", async () => {
    await scenario();
    expect((await leave(C)).statusCode).toBe(204);
    const before = await fullSnapshot();
    expect((await leave(C)).statusCode).toBe(404);
    expect((await leave(X)).statusCode).toBe(404);
    expect(await fullSnapshot()).toEqual(before);
    expect((await f.request("POST", `/trips/${new ObjectId()}/leave`, undefined, C)).statusCode).toBe(404);
  }, 30_000);

  it("rejects the owner with 409 and not a single write, until the ownership is transferred", async () => {
    await scenario();
    const before = await fullSnapshot();
    const rejected = await leave(O);
    expect(rejected.statusCode).toBe(409);
    expect(body(rejected)).toEqual({ error: { code: "TripOwnerProtectedError", message: "The Trip owner is protected." } });
    expect(await fullSnapshot()).toEqual(before);
    expect((await transfer(O, B)).statusCode).toBe(204);
    expect((await leave(O)).statusCode).toBe(204);
    expect(await isMember(O)).toBe(false);
    expect(String(await owner())).toBe(String(B));
    expect((await leave(B)).statusCode).toBe(409);
  }, 30_000);

  it("lets an admin that is not the owner leave", async () => {
    const plans = await scenario();
    await participate(plans.empty, B, "going");
    expect((await leave(B)).statusCode).toBe(204);
    expect(await isMember(B)).toBe(false);
    expect(await held(B)).toEqual([]);
    expect(String(await owner())).toBe(String(O));
  }, 30_000);

  it("in a Trip without owner an admin cannot leave but a participant can", async () => {
    await f.db.collection("trips").updateOne({ _id: f.trip }, { $unset: { ownerId: "" } });
    const before = await fullSnapshot();
    expect((await leave(B)).statusCode).toBe(409);
    expect(await fullSnapshot()).toEqual(before);
    expect((await leave(C)).statusCode).toBe(204);
  }, 30_000);

  it("compares the start with the instant of the leave: before and at it is kept, after it is deleted (controlled clock)", async () => {
    const instant = new Date("2099-06-10T12:00:00.000Z");
    const before = await addActivity(futureDay, new Date(instant.getTime() - 1));
    const equal = await addActivity(futureDay, new Date(instant.getTime()));
    const after = await addActivity(futureDay, new Date(instant.getTime() + 1));
    for (const activity of [before, equal, after]) await participate(activity, C, "going");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(instant);
    const response = await leave(C);
    vi.useRealTimers();
    expect(response.statusCode).toBe(204);
    expect(await held(C)).toEqual(sorted(before, equal));
  }, 30_000);

  it("ignores the duration: a started activity ending after the instant is kept, a short future one is deleted (controlled clock)", async () => {
    const instant = new Date("2099-06-10T12:00:00.000Z");
    const startedLong = await addActivity(futureDay, new Date(instant.getTime() - 60_000), 600);
    const futureShort = await addActivity(futureDay, new Date(instant.getTime() + 60_000), 1);
    for (const activity of [startedLong, futureShort]) await participate(activity, C, "going");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(instant);
    const response = await leave(C);
    vi.useRealTimers();
    expect(response.statusCode).toBe(204);
    expect(await held(C)).toEqual(sorted(startedLong));
  }, 30_000);

  it("in a Trip whose owner has the participant role (inconsistent data) an admin cannot leave but a participant can", async () => {
    await f.db.collection("tripMembers").updateOne({ tripId: f.trip, userId: O }, { $set: { role: "participant" } });
    const before = await fullSnapshot();
    expect((await leave(B)).statusCode).toBe(409);
    expect(await fullSnapshot()).toEqual(before);
    expect((await leave(C)).statusCode).toBe(204);
  }, 30_000);

  it("lets an expelled participant keep started participations and drops the future ones with the same cleanup", async () => {
    const plans = await scenario();
    expect((await expel(B, C)).statusCode).toBe(204);
    expect(await held(C)).toEqual(sorted(plans.started));
    expect(await f.db.collection("outboxEvents").countDocuments({ type: "member.expelled", userId: C })).toBe(1);
    expect((await expel(O, D)).statusCode).toBe(204);
    expect(await held(D)).toEqual(sorted(plans.started));
  }, 30_000);

  describe("serialized with concurrent writers", () => {
    const pause = () => new Promise((resolve) => setTimeout(resolve, 500));
    const launch = <T>(promise: Promise<T>) => { launched.push(promise); return promise; };
    // The first operation takes the Trip lock and stays paused (transaction open) until released; the rival starts meanwhile.
    const pausedFirst = () => {
      const trips = f.db.collection("trips"), original = f.db.collection.bind(f.db);
      const real = trips.updateOne.bind(trips);
      let reached!: () => void, release!: () => void, first = true;
      const reachedPromise = new Promise<void>((resolve) => { reached = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      pendingReleases.push(() => release());
      vi.spyOn(trips, "updateOne").mockImplementation((async (...args: Parameters<typeof real>) => {
        const result = await real(...args);
        if (first) { first = false; reached(); await gate; }
        return result;
      }) as never);
      vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === "trips" ? trips : original(key, options));
      return { reached: reachedPromise, release: () => release() };
    };
    const ordered = async <A, B2>(first: () => Promise<A>, second: () => Promise<B2>): Promise<[A, B2]> => {
      const paused = pausedFirst();
      const a = launch(first());
      let b!: Promise<B2>, settled = false;
      try {
        await paused.reached;
        b = launch(second()); void b.finally(() => { settled = true; });
        await pause();
        expect(settled, "the second operation finished while the first transaction was open").toBe(false);
      } finally { paused.release(); }
      return [await a, await b];
    };
    const vote = (user: ObjectId, activity: ObjectId, status = "going") => call(user, "PUT", `/activities/${activity}/participation`, { status });
    const move = (activity: ObjectId, day: ObjectId, scheduledAt: Date) =>
      call(O, "PATCH", `/activities/${activity}`, { dayId: day.toHexString(), scheduledAt: scheduledAt.toISOString() });

    it("participation first: the cleanup of the leave then deletes it", async () => {
      const plans = await scenario();
      const [voted, left] = await ordered(() => vote(C, plans.empty), () => leave(C));
      expect([voted.statusCode, left.statusCode]).toEqual([200, 204]);
      expect(await held(C)).toEqual(sorted(plans.started));
    }, 30_000);

    it("leave first: the participation answers 404 and leaves no document", async () => {
      const plans = await scenario();
      const [left, voted] = await ordered(() => leave(C), () => vote(C, plans.empty));
      expect([left.statusCode, voted.statusCode]).toEqual([204, 404]);
      expect(await held(C)).toEqual(sorted(plans.started));
    }, 30_000);

    it("an edit that starts the activity before the leave keeps the participation as record", async () => {
      const plans = await scenario();
      const [edited, left] = await ordered(() => move(plans.going, pastDay, at(PAST, 16)), () => leave(C));
      expect([edited.statusCode, left.statusCode]).toEqual([200, 204]);
      expect(await held(C)).toEqual(sorted(plans.started, plans.going));
    }, 30_000);

    it("a leave before the edit has already deleted the participation: the edit does not bring it back", async () => {
      const plans = await scenario();
      const [left, edited] = await ordered(() => leave(C), () => move(plans.going, pastDay, at(PAST, 16)));
      expect([left.statusCode, edited.statusCode]).toEqual([204, 200]);
      expect(await held(C)).toEqual(sorted(plans.started));
    }, 30_000);

    it("an edit that moves a started activity to the future before the leave makes the leave delete the participation", async () => {
      const plans = await scenario();
      const [edited, left] = await ordered(() => move(plans.started, futureDay, at(FUTURE, 16)), () => leave(C));
      expect([edited.statusCode, left.statusCode]).toEqual([200, 204]);
      expect(await held(C)).toEqual([]);
    }, 30_000);

    it("a leave before the edit keeps the participation of the activity that had already started", async () => {
      const plans = await scenario();
      const [left, edited] = await ordered(() => leave(C), () => move(plans.started, futureDay, at(FUTURE, 16)));
      expect([left.statusCode, edited.statusCode]).toEqual([204, 200]);
      expect(await held(C)).toEqual(sorted(plans.started));
    }, 30_000);

    it("an activity created by the leaving user first: it stays listed, its Voy is cleaned", async () => {
      const [created, left] = await ordered(
        () => call(C, "POST", "/activities", { title: "Mío", dayId: futureDay.toHexString(), scheduledAt: at(FUTURE, 18).toISOString() }),
        () => leave(C));
      expect([created.statusCode, left.statusCode]).toEqual([201, 204]);
      expect(await f.db.collection("activities").countDocuments({ createdBy: C })).toBe(1);
      expect(await held(C)).toEqual([]);
    }, 30_000);

    it("a leave first: the activity of the leaving user is rejected and nothing is written", async () => {
      const [left, created] = await ordered(
        () => leave(C),
        () => call(C, "POST", "/activities", { title: "Mío", dayId: futureDay.toHexString(), scheduledAt: at(FUTURE, 18).toISOString() }));
      expect([left.statusCode, created.statusCode]).toEqual([204, 404]);
      expect(await f.db.collection("activities").countDocuments({ createdBy: C })).toBe(0);
    }, 30_000);

    it("two simultaneous leaves of the same user: one 204 and one 404", async () => {
      const plans = await scenario();
      const responses = await Promise.all([leave(C), leave(C)]);
      expect(responses.map((response) => response.statusCode).sort()).toEqual([204, 404]);
      expect(await held(C)).toEqual(sorted(plans.started));
    }, 30_000);

    it("a leave and an expulsion of the same user: effective once", async () => {
      await scenario();
      const [left, expelled] = await Promise.all([leave(C), expel(B, C)]);
      expect([[204, 404], [404, 204]]).toContainEqual([left.statusCode, expelled.statusCode]);
      expect(await isMember(C)).toBe(false);
      expect(await f.db.collection("outboxEvents").countDocuments({ type: "member.expelled", userId: C })).toBe(expelled.statusCode === 204 ? 1 : 0);
    }, 30_000);

    it("a transfer to the leaving user: either he becomes owner and cannot leave, or he left and the transfer fails", async () => {
      await scenario();
      const [transferred, left] = await Promise.all([transfer(O, C), leave(C)]);
      expect([[204, 409], [404, 204]]).toContainEqual([transferred.statusCode, left.statusCode]);
      const finalOwner = String(await owner());
      expect(finalOwner).toBe(String(left.statusCode === 409 ? C : O));
      expect(await isMember(new ObjectId(finalOwner))).toBe(true);
      expect(await f.db.collection("tripMembers").findOne({ tripId: f.trip, userId: new ObjectId(finalOwner) })).toMatchObject({ role: "admin" });
    }, 30_000);

    it("the owner leaving concurrent with the transfer: never a Trip without an owner member", async () => {
      await scenario();
      const [transferred, left] = await Promise.all([transfer(O, B), leave(O)]);
      expect(transferred.statusCode).toBe(204);
      expect([204, 409]).toContain(left.statusCode);
      expect(String(await owner())).toBe(String(B));
      expect(await isMember(O)).toBe(left.statusCode !== 204);
      expect(await f.db.collection("tripMembers").findOne({ tripId: f.trip, userId: B })).toMatchObject({ role: "admin" });
    }, 30_000);
  });
});
