import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { PostFixture, domainId } from "../../test/post-fixture.js";
import { createSnsPushProvider, type SnsPushClient } from "../adapters/aws/sns-push-provider.js";
import { createMongoPushDeviceRepository } from "../adapters/mongodb/push-device-repository.js";
import { createMongoUserNotificationQueryRepository } from "../adapters/mongodb/user-notification-repository.js";
import { createEventsHandler, createEventsRun } from "../events-lambda.js";

/**
 * Push dispatch over a real transactional MongoDB, with the operations of T91 that generate the events and a fake SNS client. No network,
 * no AWS, no real token: every value below is a fake sentinel.
 */
describe("push dispatch of persisted events", () => {
  const f = new PostFixture();
  beforeAll(() => f.start("push_dispatch"), 120_000);
  afterAll(() => f.stop());
  afterEach(() => vi.restoreAllMocks());

  const at = (hhmm: string) => new Date(`2026-09-25T${hhmm}:00Z`);
  const ctx = (user: ObjectId) => ({ tripId: domainId(f.trip), authenticatedUserId: domainId(user) });
  const ANDROID_APP = "arn:aws:sns:us-east-1:000000000000:app/GCM/travellier-test-android";
  const IOS_APP = "arn:aws:sns:us-east-1:000000000000:app/APNS_SANDBOX/travellier-test-ios";

  interface Push { token: string; title: string; body: string; data: Record<string, string> }
  let published: Push[] = [];
  let failingTokens = new Set<string>();
  let invalidTokens = new Set<string>();
  let clockOffsetMs = 0;
  let owners = 0;
  const logs: Record<string, unknown>[] = [];
  const awsError = (name: string) => Object.assign(new Error("fake sdk message"), { name });

  const client: SnsPushClient = {
    createPlatformEndpoint: async ({ Token }) => ({ EndpointArn: `fake-endpoint/${Token}` }),
    publish: async ({ TargetArn, Message }) => {
      const token = TargetArn.replace("fake-endpoint/", "");
      if (invalidTokens.has(token)) throw awsError("EndpointDisabledException");
      if (failingTokens.has(token)) throw awsError("ThrottledException");
      const body = JSON.parse(Message) as { GCM?: string; APNS_SANDBOX?: string };
      if (body.GCM !== undefined) {
        const { notification, data } = (JSON.parse(body.GCM) as { fcmV1Message: { message: { notification: { title: string; body: string }; data: Record<string, string> } } }).fcmV1Message.message;
        published.push({ token, title: notification.title, body: notification.body, data });
      } else {
        const { aps, data } = JSON.parse(body.APNS_SANDBOX ?? "") as { aps: { alert: { title: string; body: string } }; data: Record<string, string> };
        published.push({ token, title: aps.alert.title, body: aps.alert.body, data });
      }
      return {};
    },
  };
  const now = () => new Date(Date.now() + clockOffsetMs);
  const handler = () => createEventsHandler({ expectedStage: "test", now, deadlineMs: 45_000, log: (entry) => { logs.push(entry); },
    run: createEventsRun({ now, createOwner: () => `owner-${(owners += 1)}`,
      loadRuntime: async () => ({ database: f.db, provider: createSnsPushProvider({ client, applications: { android: ANDROID_APP, ios: IOS_APP } }) }) }) });
  const tick = async () => handler()({ Records: [{ messageId: "m1", body: JSON.stringify({ kind: "events", stage: "test" }) }] });

  const tokenOf = (user: ObjectId, suffix = "a") => `FAKE-token-${user.toHexString()}-${suffix}`;
  const addMember = async (role: "admin" | "participant" = "participant", devices: string[] = ["a"]) => {
    const userId = new ObjectId();
    await f.db.collection("tripMembers").insertOne({ tripId: f.trip, userId, role, joinedAt: new Date() });
    await registerDevices(userId, devices);
    return userId;
  };
  const registerDevices = async (userId: ObjectId, suffixes: string[]) => {
    for (const suffix of suffixes) {
      const result = await createMongoPushDeviceRepository(f.db).register({ userId: domainId(userId), provider: "fcm", platform: "android", token: tokenOf(userId, suffix), now: new Date(), limit: 10 });
      if (!result.ok) throw result.error;
    }
  };
  const pushesTo = (user: ObjectId) => published.filter((push) => push.token.startsWith(`FAKE-token-${user.toHexString()}-`));
  const events = (filter: Record<string, unknown> = {}) => f.db.collection("outboxEvents").find(filter).sort({ _id: 1 }).toArray();
  const eventOf = async (type: string, userId: ObjectId) => (await events({ type, userId }))[0]!;

  const createActivity = async (user: ObjectId, title: string, start: string, durationMinutes: number | null = 60) => {
    const result = await f.api.createActivity!({ ...ctx(user), dayId: domainId(f.day), title, scheduledAt: at(start), durationMinutes });
    if (!result.ok || result.value.outcome !== "created") throw new Error(JSON.stringify(result));
    return new ObjectId(result.value.activity.id);
  };
  const going = async (user: ObjectId, activityId: ObjectId) => {
    const result = await f.api.setActivityParticipation!({ ...ctx(user), activityId: domainId(activityId), status: "going" });
    if (!result.ok || result.value.outcome !== "saved") throw new Error(JSON.stringify(result));
  };
  const edit = (activityId: ObjectId, patch: Record<string, unknown>, user = f.actor) => f.api.updateActivity!({ ...ctx(user), activityId: domainId(activityId), ...patch });
  const strip = (documents: Record<string, unknown>[]) => documents.map(({ status, attempts, leaseUntil, leaseOwner, lastAttemptAt, completedAt, outcome, lastErrorCode,
    deliveredDeviceIds, availableAt, ...rest }) => { void [status, attempts, leaseUntil, leaseOwner, lastAttemptAt, completedAt, outcome, lastErrorCode, deliveredDeviceIds, availableAt]; return rest; });
  const inboxes = async (users: ObjectId[]) => Promise.all(users.map(async (user) => createMongoUserNotificationQueryRepository(f.db).listForUser({ userId: domainId(user), limit: 50 })));

  beforeEach(async () => {
    vi.restoreAllMocks();
    await f.reset();
    await f.db.collection("pushDevices").deleteMany({});
    await registerDevices(f.actor, ["a"]);
    published = []; failingTokens = new Set(); invalidTokens = new Set(); clockOffsetMs = 0; owners = 0; logs.length = 0;
  });

  describe("activities", () => {
    // A: u1 + u2 going (u2 compatible); B: u1 going; u3 pending; the editor is the actor.
    const scenario = async () => {
      const [u1, u2, u3] = [await addMember(), await addMember(), await addMember()];
      const a = await createActivity(u1, "A", "12:00"), b = await createActivity(u1, "B", "14:00");
      await going(u2, a);
      await f.db.collection("outboxEvents").deleteMany({});
      return { u1, u2, u3, a, b };
    };

    it("a schedule edit pushes the unlinking only to the affected member and the update to the rest, never to the editor", async () => {
      const { u1, u2, u3, a } = await scenario();
      expect((await edit(a, { scheduledAt: at("14:30") })).ok).toBe(true);
      expect(await tick()).toEqual({ batchItemFailures: [] });
      expect(pushesTo(u1)).toHaveLength(1);
      expect(pushesTo(u1)[0]).toMatchObject({ body: "Cambió el horario y se superpone con otro plan. Se retiró tu participación; revisá la actividad y elegí de nuevo.",
        data: { type: "activity.participant_unlinked", tripId: f.trip.toHexString(), activityId: a.toHexString(), scheduledAt: "2026-09-25T14:30:00.000Z", durationMinutes: "60",
          notificationId: (await eventOf("activity.participant_unlinked", u1))._id.toHexString() } });
      for (const user of [u2, u3]) expect(pushesTo(user).map((push) => push.data.type)).toEqual(["activity.updated"]);
      expect(pushesTo(f.actor)).toEqual([]);
      expect(published).toHaveLength(3);
      expect(JSON.stringify(published)).not.toMatch(/incompatible|changedFields|voto|aprob/i);
    });

    it.each([
      ["content", { title: "Nuevo título secreto", description: "Descripción secreta" }],
      ["location", { mapsUrl: "https://maps.app.goo.gl/secreto" }],
      ["start", { scheduledAt: at("16:00") }],
      ["duration", { durationMinutes: 30 }],
    ] as const)("a %s edit pushes activity.updated with the exact activity id and no text of the edit", async (_name, patch) => {
      const { u1, u2, u3, a } = await scenario();
      expect((await edit(a, patch)).ok).toBe(true);
      await tick();
      for (const user of [u1, u2, u3]) {
        expect(pushesTo(user)).toHaveLength(1);
        expect(pushesTo(user)[0]!.data).toMatchObject({ type: "activity.updated", activityId: a.toHexString(), tripId: f.trip.toHexString() });
      }
      expect(JSON.stringify(published)).not.toMatch(/secret|maps\.app/i);
      expect(pushesTo(f.actor)).toEqual([]);
    });

    it("a duration edit that creates a conflict unlinks and pushes the new duration to the affected member only", async () => {
      const { u1, u2, a } = await scenario();
      expect((await edit(a, { durationMinutes: 180 })).ok).toBe(true);
      await tick();
      expect(pushesTo(u1)[0]!.data).toMatchObject({ type: "activity.participant_unlinked", durationMinutes: "180" });
      expect(pushesTo(u2)[0]!.data.type).toBe("activity.updated");
    });

    it("a spontaneous activity pushes activity.created and post.created to the other members, not to the author", async () => {
      const other = await addMember();
      const created = await f.api.createPost!({ ...f.context(), description: "Cena", newActivity: { title: "Cena", scheduledAt: f.occurrence, durationMinutes: 60 } });
      if (!created.ok || created.value.outcome !== "created") throw new Error("Post not created.");
      await tick();
      expect(pushesTo(other).map((push) => push.data.type).sort()).toEqual(["activity.created", "post.created"]);
      expect(pushesTo(other).find((push) => push.data.type === "post.created")!.data).toMatchObject({ postId: created.value.post.id, activityId: created.value.activity!.id });
      expect(pushesTo(f.actor)).toEqual([]);
      expect(JSON.stringify(published)).not.toContain("Cena");
    });
  });

  it("a comment pushes comment.created to the other members with its ids and no text", async () => {
    const other = await addMember();
    const post = await f.api.createPost!({ ...f.context(), description: "Recuerdo" });
    if (!post.ok || post.value.outcome !== "created") throw new Error("Post not created.");
    const comment = await f.api.createComment!({ ...f.context(), postId: domainId(new ObjectId(post.value.post.id)), text: "Comentario privado" });
    if (!comment.ok) throw comment.error;
    await tick();
    const mine = pushesTo(other).filter((push) => push.data.type === "comment.created");
    expect(mine).toHaveLength(1);
    expect(mine[0]!.data).toMatchObject({ commentId: comment.value.id, postId: post.value.post.id, tripId: f.trip.toHexString() });
    expect(JSON.stringify(published)).not.toContain("Comentario privado");
  });

  it("a new member pushes member.joined to the others, and an expulsion pushes only to the expelled user, who no longer is a member", async () => {
    const other = await addMember("admin");
    const joiner = new ObjectId();
    expect(await f.api.joinByCode({ authenticatedUserId: domainId(joiner), code: f.trip.toHexString() })).toMatchObject({ ok: true, value: { joined: true } });
    await registerDevices(joiner, ["a"]);
    await tick();
    expect(pushesTo(other).map((push) => push.data.type)).toEqual(["member.joined"]);
    expect(pushesTo(f.actor).map((push) => push.data.type)).toEqual(["member.joined"]);
    expect(pushesTo(joiner)).toEqual([]);
    published = [];
    expect((await f.api.expelMember!({ tripId: domainId(f.trip), actorUserId: domainId(other), targetUserId: domainId(f.actor) })).ok).toBe(true);
    await tick();
    expect(published).toHaveLength(1);
    expect(pushesTo(f.actor)[0]!.data).toEqual({ notificationId: (await eventOf("member.expelled", f.actor))._id.toHexString(), type: "member.expelled", tripId: f.trip.toHexString() });
  });

  it("an expulsion is not pushed when the user already rejoined", async () => {
    const admin = await addMember("admin");
    expect((await f.api.expelMember!({ tripId: domainId(f.trip), actorUserId: domainId(admin), targetUserId: domainId(f.actor) })).ok).toBe(true);
    expect(await f.api.joinByCode({ authenticatedUserId: domainId(f.actor), code: f.trip.toHexString() })).toMatchObject({ ok: true, value: { joined: true } });
    published = [];
    await f.db.collection("outboxEvents").updateMany({ type: "member.joined" }, { $set: { status: "sent" } });
    await tick();
    expect(published).toEqual([]);
    expect(await events({ type: "member.expelled" })).toMatchObject([{ status: "skipped", outcome: "rejoined" }]);
  });

  it("a transaction that fails leaves no event and therefore no push", async () => {
    await addMember();
    const outbox = f.db.collection("outboxEvents"), original = f.db.collection.bind(f.db);
    vi.spyOn(outbox, "bulkWrite").mockRejectedValueOnce(new Error("forced failure"));
    vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === "outboxEvents" ? outbox : original(key, options));
    expect(await f.api.createPost!({ ...f.context(), description: "Hola" })).toMatchObject({ ok: false });
    vi.restoreAllMocks();
    expect(await events()).toEqual([]);
    await tick();
    expect(published).toEqual([]);
  });

  it("a membership revoked after the event was saved is not pushed", async () => {
    const other = await addMember();
    expect((await f.api.createPost!({ ...f.context(), description: "Recuerdo" })).ok).toBe(true);
    await f.db.collection("tripMembers").deleteOne({ tripId: f.trip, userId: other });
    await tick();
    expect(pushesTo(other)).toEqual([]);
    expect(await events({ userId: other })).toMatchObject([{ status: "skipped", outcome: "not_member" }]);
  });

  it("the events of a deleted Trip are skipped, and the deletion API leaves nothing to push", async () => {
    await addMember();
    expect((await f.api.createPost!({ ...f.context(), description: "Recuerdo" })).ok).toBe(true);
    await f.db.collection("trips").deleteOne({ _id: f.trip });
    await tick();
    expect(published).toEqual([]);
    expect(await events()).toMatchObject([{ status: "skipped", outcome: "trip_deleted" }]);
  });

  it("a user without devices completes as sent/no_devices without error", async () => {
    const other = await addMember("participant", []);
    expect((await f.api.createPost!({ ...f.context(), description: "Recuerdo" })).ok).toBe(true);
    expect(await tick()).toEqual({ batchItemFailures: [] });
    expect(await events({ userId: other })).toMatchObject([{ status: "sent", outcome: "no_devices" }]);
  });

  it("an invalid token is removed once and does not stop the valid device or get retried", async () => {
    const other = await addMember("participant", ["good", "bad"]);
    invalidTokens.add(tokenOf(other, "bad"));
    expect((await f.api.createPost!({ ...f.context(), description: "Recuerdo" })).ok).toBe(true);
    await tick();
    expect(pushesTo(other)).toHaveLength(1);
    expect(await f.db.collection("pushDevices").countDocuments({ userId: other })).toBe(1);
    expect(await events({ userId: other })).toMatchObject([{ status: "sent", outcome: "delivered" }]);
    clockOffsetMs = 7 * 3_600_000;
    await tick();
    expect(pushesTo(other)).toHaveLength(1);
  });

  it("retries after a partial failure only for the failed device, with backoff, and never duplicates the delivered one", async () => {
    const other = await addMember("participant", ["a", "b"]);
    failingTokens.add(tokenOf(other, "b"));
    expect((await f.api.createPost!({ ...f.context(), description: "Recuerdo" })).ok).toBe(true);
    await tick();
    expect(pushesTo(other).map((push) => push.token)).toEqual([tokenOf(other, "a")]);
    const [stored] = await events({ userId: other });
    expect(stored).toMatchObject({ status: "pending", attempts: 1, lastErrorCode: "throttled" });
    expect(stored!.availableAt.getTime()).toBeGreaterThan(Date.now());
    expect(stored!.deliveredDeviceIds).toHaveLength(1);
    await tick();
    expect(pushesTo(other)).toHaveLength(1);
    failingTokens.clear();
    clockOffsetMs = 2 * 60_000;
    await tick();
    expect(pushesTo(other).map((push) => push.token).sort()).toEqual([tokenOf(other, "a"), tokenOf(other, "b")]);
    expect(await events({ userId: other })).toMatchObject([{ status: "sent", outcome: "delivered" }]);
    await tick();
    expect(pushesTo(other)).toHaveLength(2);
  });

  it("leaves an event failed, not deleted, after five attempts", async () => {
    const other = await addMember();
    failingTokens.add(tokenOf(other));
    expect((await f.api.createPost!({ ...f.context(), description: "Recuerdo" })).ok).toBe(true);
    for (let attempt = 1; attempt <= 6; attempt += 1) { await tick(); clockOffsetMs += 3_600_000; }
    expect(await events({ userId: other })).toMatchObject([{ status: "failed", attempts: 5 }]);
    expect(await f.db.collection("pushDevices").countDocuments({ userId: other })).toBe(1);
  });

  it("two workers running at once deliver each event once per device", async () => {
    const [u1, u2] = [await addMember("participant", ["a", "b"]), await addMember()];
    for (let index = 0; index < 4; index += 1) expect((await f.api.createPost!({ ...f.context(), description: `Recuerdo ${index}` })).ok).toBe(true);
    await Promise.all([tick(), tick()]);
    await tick();
    expect(pushesTo(u1)).toHaveLength(8);
    expect(pushesTo(u2)).toHaveLength(4);
    const keys = published.map((push) => `${push.token}:${push.data.notificationId}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(await f.db.collection("outboxEvents").countDocuments({ status: "pending" })).toBe(0);
  });

  it("dispatching never changes the notices of the app", async () => {
    const [u1, u2, u3] = [await addMember(), await addMember(), await addMember("participant", [])];
    const a = await createActivity(u1, "A", "12:00"), b = await createActivity(u1, "B", "14:00");
    await going(u2, a);
    await going(u1, b);
    expect((await edit(a, { scheduledAt: at("14:30") })).ok).toBe(true);
    expect((await f.api.createPost!({ ...f.context(), description: "Recuerdo" })).ok).toBe(true);
    const users = [f.actor, u1, u2, u3];
    const before = { documents: strip(await events()), inboxes: await inboxes(users) };
    await tick();
    await tick();
    expect(published.length).toBeGreaterThan(0);
    expect(strip(await events())).toEqual(before.documents);
    expect(await inboxes(users)).toEqual(before.inboxes);
    expect(await f.db.collection("outboxEvents").countDocuments()).toBe(before.documents.length);
  });

  it("logs only counters", async () => {
    const other = await addMember();
    failingTokens.add(tokenOf(other));
    expect((await f.api.createPost!({ ...f.context(), description: "Recuerdo" })).ok).toBe(true);
    await tick();
    const serialized = JSON.stringify(logs);
    expect(logs.length).toBeGreaterThan(0);
    expect(serialized).not.toContain("FAKE-token");
    expect(serialized).not.toContain(other.toHexString());
    expect(serialized).not.toContain("fake-endpoint");
  });
});
