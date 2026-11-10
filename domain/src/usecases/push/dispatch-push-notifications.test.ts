import { describe, expect, it } from "vitest";

import { PUSH_DISPATCH_LEASE_SECONDS, PUSH_DISPATCH_MAX_ATTEMPTS, PUSH_DISPATCH_VALIDITY_MS, computePushRetryDelay } from "../../entities/push-dispatch.js";
import type { PushDevice, PushProvider } from "../../entities/push-device.js";
import type { TripNotificationType } from "../../entities/trip-notification.js";
import { UnknownError } from "../../errors/unknown-error.js";
import type { DispatchAudiencePort, PushDispatchClaim, PushDispatchPort, PushProviderPort, PushSendResult } from "../../ports/push-dispatch-port.js";
import { err, ok } from "../../types/result.js";
import { createObjectId, type ObjectId } from "../../value-objects/object-id.js";
import { dispatchPushNotifications, type DispatchPushNotificationsDeps } from "./dispatch-push-notifications.js";

const id = (value: string): ObjectId => {
  const result = createObjectId(value);
  if (!result.ok) throw new Error("bad id");
  return result.value;
};
const T0 = new Date("2026-11-10T12:00:00.000Z");
const trip = id("507f1f77bcf86cd799439011"), user = id("507f1f77bcf86cd799439012"), actor = id("507f1f77bcf86cd799439013");
const eventId = id("507f1f77bcf86cd799439021"), eventId2 = id("507f1f77bcf86cd799439022"), activity = id("507f1f77bcf86cd799439031");
const devA = id("507f1f77bcf86cd799439041"), devB = id("507f1f77bcf86cd799439042");

const device = (deviceId: ObjectId, token: string, provider: PushProvider = "fcm"): PushDevice => ({ id: deviceId, userId: user, provider,
  platform: provider === "fcm" ? "android" : "ios", token, createdAt: T0, updatedAt: T0, lastRegisteredAt: T0 });

interface Row { claim: PushDispatchClaim; status: string; outcome?: string; availableAt: Date; leaseOwner?: string; leaseUntil?: Date; lastErrorCode?: string; attempts: number }

const claimOf = (type: TripNotificationType, over: Partial<PushDispatchClaim> = {}): PushDispatchClaim => {
  const base = { id: eventId, tripId: trip, userId: user, createdAt: T0, attempts: 0, deliveredDeviceIds: [] as ObjectId[] };
  const payloads = {
    "post.created": { postId: activity, actorId: actor, activityId: null },
    "activity.created": { activityId: activity, actorId: actor, scheduledAt: T0, durationMinutes: null },
    "activity.updated": { activityId: activity, actorId: actor, changedFields: ["scheduledAt"] },
    "activity.participant_unlinked": { activityId: activity, reason: "schedule_conflict", changedFields: ["scheduledAt"], changedAt: T0,
      newInterval: { startsAt: T0, durationMinutes: 60, endsAt: T0 }, incompatibleActivities: [] },
    "member.joined": { memberId: actor, userId: actor },
    "member.expelled": { tripId: trip },
    "comment.created": { commentId: activity, postId: activity, actorId: actor },
  };
  return { ...base, type, payload: payloads[type], ...over } as PushDispatchClaim;
};

interface SetupOptions {
  devices?: PushDevice[]; members?: boolean; tripExists?: boolean; sends?: (token: string) => PushSendResult | "error" | "throw";
  clock?: () => Date; deadline?: Date; maxEvents?: number; recordDelivered?: "ok" | "lost" | "fail";
}

const setup = (rows: Row[], options: SetupOptions = {}) => {
  const sent: { token: string; dedupeId: string; data: Record<string, string> }[] = [];
  const removed: { provider: PushProvider; tokens: readonly string[] }[] = [];
  let claimFails = false;
  const writes: string[] = [];
  const dispatch: PushDispatchPort = {
    claimNext: async ({ now, leaseUntil, owner }) => {
      if (claimFails) return err(new UnknownError("db"));
      const found = rows.find((r) => r.status === "pending" && r.availableAt <= now && (r.leaseUntil === undefined || r.leaseUntil <= now));
      if (!found) return ok(undefined);
      found.leaseOwner = owner;
      found.leaseUntil = leaseUntil;
      return ok({ ...found.claim, attempts: found.attempts, deliveredDeviceIds: [...found.claim.deliveredDeviceIds] });
    },
    recordDelivered: async (eid, owner, deviceId) => {
      writes.push("recordDelivered");
      if (options.recordDelivered === "fail") return err(new UnknownError("db"));
      const found = rows.find((r) => r.claim.id === eid && r.leaseOwner === owner);
      if (!found || options.recordDelivered === "lost") return ok(false);
      found.claim.deliveredDeviceIds = [...new Set([...found.claim.deliveredDeviceIds, deviceId])];
      return ok(true);
    },
    complete: async (eid, owner, input) => {
      writes.push("complete");
      const found = rows.find((r) => r.claim.id === eid && r.leaseOwner === owner);
      if (!found) return ok(false);
      found.status = input.status;
      found.outcome = input.outcome;
      found.leaseOwner = undefined;
      found.leaseUntil = undefined;
      return ok(true);
    },
    release: async (eid, owner, input) => {
      writes.push("release");
      const found = rows.find((r) => r.claim.id === eid && r.leaseOwner === owner);
      if (!found) return ok(false);
      Object.assign(found, { status: input.status, attempts: input.attempts, availableAt: input.nextAttemptAt, lastErrorCode: input.lastErrorCode });
      found.leaseOwner = undefined;
      found.leaseUntil = undefined;
      return ok(true);
    },
  };
  const audience: DispatchAudiencePort = {
    isCurrentMember: async () => ok(options.members ?? true),
    tripExists: async () => ok(options.tripExists ?? true),
  };
  const devices = { listForUser: async () => ok(options.devices ?? [device(devA, "token-a")]) };
  const provider: PushProviderPort = {
    send: async ({ device: target, message, dedupeId }) => {
      sent.push({ token: target.token, dedupeId, data: message.data });
      const outcome = options.sends?.(target.token) ?? { kind: "delivered" as const };
      if (outcome === "throw") throw new Error("boom");
      return outcome === "error" ? err(new UnknownError("provider")) : ok(outcome);
    },
  };
  const removeInvalid: DispatchPushNotificationsDeps["removeInvalid"] = { removeInvalid: async (p, tokens) => { removed.push({ provider: p, tokens }); return ok(tokens.length); } };
  let counter = 0;
  const deps: DispatchPushNotificationsDeps = { dispatch, audience, devices, provider, removeInvalid, now: options.clock ?? (() => T0),
    createOwner: () => `owner-${(counter += 1)}`, deadline: options.deadline ?? new Date(T0.getTime() + 45_000), maxEvents: options.maxEvents ?? 20 };
  return { deps, sent, removed, writes, rows, failClaim: () => { claimFails = true; } };
};

const pending = (claim: PushDispatchClaim, over: Partial<Row> = {}): Row => ({ claim, status: "pending", availableAt: T0, attempts: 0, ...over });
const summaryOf = async (deps: DispatchPushNotificationsDeps) => {
  const result = await dispatchPushNotifications(deps);
  if (!result.ok) throw new Error("run failed");
  return result.value;
};

describe("dispatchPushNotifications", () => {
  it.each(["post.created", "activity.created", "activity.updated", "member.joined", "comment.created", "activity.participant_unlinked"] as TripNotificationType[])(
    "delivers %s to a current member and completes it as sent", async (type) => {
      const t = setup([pending(claimOf(type))]);
      const summary = await summaryOf(t.deps);
      expect(t.sent).toHaveLength(1);
      expect(t.sent[0]).toMatchObject({ token: "token-a", dedupeId: `${eventId}:${devA}`, data: { notificationId: eventId, type, tripId: trip } });
      expect(t.rows[0]).toMatchObject({ status: "sent", outcome: "delivered" });
      expect(summary).toMatchObject({ claimed: 1, delivered: 1 });
    });

  it("delivers an expulsion only to someone who is not a member today", async () => {
    const gone = setup([pending(claimOf("member.expelled"))], { members: false });
    await dispatchPushNotifications(gone.deps);
    expect(gone.sent).toHaveLength(1);
    expect(gone.sent[0]?.data).toEqual({ notificationId: eventId, type: "member.expelled", tripId: trip });
    expect(gone.rows[0]).toMatchObject({ status: "sent", outcome: "delivered" });
  });

  it("omits an expulsion when the user rejoined", async () => {
    const t = setup([pending(claimOf("member.expelled"))], { members: true });
    const summary = await summaryOf(t.deps);
    expect(t.sent).toHaveLength(0);
    expect(t.rows[0]).toMatchObject({ status: "skipped", outcome: "rejoined" });
    expect(summary.skipped.rejoined).toBe(1);
  });

  it("omits the event when the membership was revoked between persistence and dispatch", async () => {
    const t = setup([pending(claimOf("activity.updated"))], { members: false });
    const summary = await summaryOf(t.deps);
    expect(t.sent).toHaveLength(0);
    expect(t.rows[0]).toMatchObject({ status: "skipped", outcome: "not_member" });
    expect(summary.skipped.not_member).toBe(1);
  });

  it("omits the events of a deleted Trip, even an expulsion", async () => {
    for (const type of ["comment.created", "member.expelled"] as TripNotificationType[]) {
      const t = setup([pending(claimOf(type))], { tripExists: false, members: false });
      const summary = await summaryOf(t.deps);
      expect(t.sent).toHaveLength(0);
      expect(t.rows[0]).toMatchObject({ status: "skipped", outcome: "trip_deleted" });
      expect(summary.skipped.trip_deleted).toBe(1);
    }
  });

  it("omits an event older than the validity window", async () => {
    const old = claimOf("comment.created", { createdAt: new Date(T0.getTime() - PUSH_DISPATCH_VALIDITY_MS - 1) });
    const t = setup([pending(old)]);
    const summary = await summaryOf(t.deps);
    expect(t.sent).toHaveLength(0);
    expect(t.rows[0]).toMatchObject({ status: "skipped", outcome: "expired" });
    expect(summary.skipped.expired).toBe(1);
  });

  it("completes as sent/no_devices when the user has no devices", async () => {
    const t = setup([pending(claimOf("comment.created"))], { devices: [] });
    const summary = await summaryOf(t.deps);
    expect(t.rows[0]).toMatchObject({ status: "sent", outcome: "no_devices" });
    expect(summary.noDevices).toBe(1);
  });

  it("removes an invalid token once per provider, does not retry and counts it", async () => {
    const t = setup([pending(claimOf("comment.created"))], { devices: [device(devA, "bad-1"), device(devB, "bad-2"), device(id("507f1f77bcf86cd799439043"), "apns-bad", "apns")],
      sends: () => ({ kind: "invalid_token" }) });
    const summary = await summaryOf(t.deps);
    expect(t.removed).toEqual([{ provider: "fcm", tokens: ["bad-1", "bad-2"] }, { provider: "apns", tokens: ["apns-bad"] }]);
    expect(t.rows[0]).toMatchObject({ status: "sent", outcome: "invalid_only" });
    expect(summary).toMatchObject({ invalidTokens: 3, invalidOnly: 1, delivered: 0 });
    expect(JSON.stringify(summary)).not.toContain("bad-");
  });

  it("delivers to the valid device and drops the invalid one", async () => {
    const t = setup([pending(claimOf("comment.created"))], { devices: [device(devA, "bad"), device(devB, "good")],
      sends: (token) => (token === "bad" ? { kind: "invalid_token" } : { kind: "delivered" }) });
    await dispatchPushNotifications(t.deps);
    expect(t.removed).toEqual([{ provider: "fcm", tokens: ["bad"] }]);
    expect(t.rows[0]).toMatchObject({ status: "sent", outcome: "delivered" });
    expect(t.rows[0]?.claim.deliveredDeviceIds).toEqual([devB]);
  });

  it("releases a transient failure with growing backoff and attempts + 1", async () => {
    const t = setup([pending(claimOf("comment.created"), { attempts: 1 })], { sends: () => ({ kind: "transient", code: "throttled" }) });
    const summary = await summaryOf(t.deps);
    expect(t.rows[0]).toMatchObject({ status: "pending", attempts: 2, lastErrorCode: "throttled" });
    expect(t.rows[0]?.availableAt).toEqual(new Date(T0.getTime() + computePushRetryDelay(2)));
    expect(summary).toMatchObject({ transient: 1, exhausted: 0 });
  });

  it("leaves the event failed, not deleted, when the attempts run out", async () => {
    const t = setup([pending(claimOf("comment.created"), { attempts: PUSH_DISPATCH_MAX_ATTEMPTS - 1 })], { sends: () => ({ kind: "transient", code: "throttled" }) });
    const summary = await summaryOf(t.deps);
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toMatchObject({ status: "failed", attempts: PUSH_DISPATCH_MAX_ATTEMPTS });
    expect(summary).toMatchObject({ transient: 1, exhausted: 1 });
  });

  it("treats an infrastructure error of the provider as transient", async () => {
    const t = setup([pending(claimOf("comment.created"))], { sends: () => "error" });
    await dispatchPushNotifications(t.deps);
    expect(t.rows[0]).toMatchObject({ status: "pending", attempts: 1, lastErrorCode: "provider_error" });
  });

  it("does not resend to devices already delivered", async () => {
    const t = setup([pending(claimOf("comment.created", { deliveredDeviceIds: [devA] }))], { devices: [device(devA, "token-a"), device(devB, "token-b")] });
    await dispatchPushNotifications(t.deps);
    expect(t.sent.map((s) => s.token)).toEqual(["token-b"]);
    expect(t.rows[0]).toMatchObject({ status: "sent", outcome: "delivered" });
  });

  it("does not send anything when every device already has it", async () => {
    const t = setup([pending(claimOf("comment.created", { deliveredDeviceIds: [devA] }))]);
    await dispatchPushNotifications(t.deps);
    expect(t.sent).toHaveLength(0);
    expect(t.rows[0]).toMatchObject({ status: "sent", outcome: "delivered" });
  });

  it("retries after a partial failure only for the failed device", async () => {
    let failB = true;
    const t = setup([pending(claimOf("comment.created"))], { devices: [device(devA, "token-a"), device(devB, "token-b")],
      sends: (token) => (token === "token-b" && failB ? { kind: "transient", code: "unavailable" } : { kind: "delivered" }) });
    await dispatchPushNotifications(t.deps);
    expect(t.rows[0]).toMatchObject({ status: "pending", attempts: 1 });
    expect(t.rows[0]?.claim.deliveredDeviceIds).toEqual([devA]);
    failB = false;
    const later = new Date(T0.getTime() + computePushRetryDelay(1));
    await dispatchPushNotifications({ ...t.deps, now: () => later, deadline: new Date(later.getTime() + 45_000) });
    expect(t.sent.map((s) => s.token)).toEqual(["token-a", "token-b", "token-b"]);
    expect(t.rows[0]).toMatchObject({ status: "sent", outcome: "delivered" });
  });

  it("treats a rejected device as permanent without removing its token", async () => {
    const mixed = setup([pending(claimOf("comment.created"))], { devices: [device(devA, "ok"), device(devB, "rejected")],
      sends: (token) => (token === "rejected" ? { kind: "rejected", code: "invalid_parameter" } : { kind: "delivered" }) });
    const summary = await summaryOf(mixed.deps);
    expect(mixed.removed).toEqual([]);
    expect(mixed.rows[0]).toMatchObject({ status: "sent", outcome: "delivered" });
    expect(summary.rejected).toBe(1);
    const only = setup([pending(claimOf("comment.created"))], { sends: () => ({ kind: "rejected", code: "authorization_error" }) });
    await dispatchPushNotifications(only.deps);
    expect(only.removed).toEqual([]);
    expect(only.rows[0]).toMatchObject({ status: "failed", lastErrorCode: "rejected" });
    expect(only.sent).toHaveLength(1);
  });

  it("stops without overwriting anything when the lease is lost", async () => {
    const t = setup([pending(claimOf("comment.created"))], { devices: [device(devA, "token-a"), device(devB, "token-b")], recordDelivered: "lost" });
    const summary = await summaryOf(t.deps);
    expect(t.sent).toHaveLength(1);
    expect(t.writes).toEqual(["recordDelivered"]);
    expect(summary.leaseLost).toBe(1);
    expect(t.rows[0]?.status).toBe("pending");
  });

  it("counts a lost lease on completion", async () => {
    const t = setup([pending(claimOf("comment.created"))]);
    t.deps.dispatch.complete = async () => ok(false);
    expect((await summaryOf(t.deps)).leaseLost).toBe(1);
  });

  it("releases with a retry when the progress cannot be saved, so it is not silently lost", async () => {
    const t = setup([pending(claimOf("comment.created"))], { devices: [device(devA, "token-a"), device(devB, "token-b")], recordDelivered: "fail" });
    await dispatchPushNotifications(t.deps);
    expect(t.sent).toHaveLength(1);
    expect(t.rows[0]).toMatchObject({ status: "pending", attempts: 1, lastErrorCode: "progress_not_saved" });
  });

  it("releases without counting an attempt when the deadline arrives, and sends nothing after it", async () => {
    let late = false;
    const t = setup([pending(claimOf("comment.created"))], { devices: [device(devA, "token-a"), device(devB, "token-b")],
      sends: () => { late = true; return { kind: "delivered" }; }, clock: () => (late ? new Date(T0.getTime() + 46_000) : T0) });
    const summary = await summaryOf(t.deps);
    expect(t.sent).toHaveLength(1);
    expect(t.rows[0]).toMatchObject({ status: "pending", attempts: 0, lastErrorCode: "deadline" });
    expect(summary.transient).toBe(0);
  });

  it("does not claim anything after the deadline", async () => {
    const t = setup([pending(claimOf("comment.created"))], { clock: () => new Date(T0.getTime() + 60_000) });
    expect((await summaryOf(t.deps)).claimed).toBe(0);
  });

  it("reports a claim failure without processing", async () => {
    const t = setup([pending(claimOf("comment.created"))]);
    t.failClaim();
    expect(await summaryOf(t.deps)).toMatchObject({ claimFailed: true, claimed: 0 });
  });

  it("respects maxEvents and leases for two minutes", async () => {
    const rows = [pending(claimOf("comment.created")), pending(claimOf("comment.created", { id: eventId2 }))];
    const t = setup(rows, { maxEvents: 1 });
    expect((await summaryOf(t.deps)).claimed).toBe(1);
    expect(rows[1]?.status).toBe("pending");
    expect(rows[1]?.leaseUntil).toBeUndefined();
    expect(PUSH_DISPATCH_LEASE_SECONDS).toBe(120);
  });

  it("keeps going with the next event after an unexpected exception and counts an attempt", async () => {
    const rows = [pending(claimOf("comment.created")), pending(claimOf("comment.created", { id: eventId2 }))];
    let first = true;
    const t = setup(rows, { sends: () => { if (first) { first = false; return "throw"; } return { kind: "delivered" }; } });
    const summary = await summaryOf(t.deps);
    expect(rows[0]).toMatchObject({ status: "pending", attempts: 1, lastErrorCode: "unexpected" });
    expect(rows[1]).toMatchObject({ status: "sent" });
    expect(summary).toMatchObject({ claimed: 2, delivered: 1, transient: 1 });
  });

  it("releases with a retry when the Trip state cannot be read", async () => {
    const t = setup([pending(claimOf("comment.created"))]);
    t.deps.audience = { isCurrentMember: async () => err(new UnknownError("db")), tripExists: async () => ok(true) };
    await dispatchPushNotifications(t.deps);
    expect(t.sent).toHaveLength(0);
    expect(t.rows[0]).toMatchObject({ status: "pending", attempts: 1, lastErrorCode: "audience_check_failed" });
  });

  it("only depends on dispatch state, audience, devices and provider: nothing can write the inbox", async () => {
    const t = setup([pending(claimOf("comment.created"))]);
    await dispatchPushNotifications(t.deps);
    expect(Object.keys(t.deps).sort()).toEqual(["audience", "createOwner", "deadline", "devices", "dispatch", "maxEvents", "now", "provider", "removeInvalid"]);
    expect(Object.keys(t.deps.dispatch).sort()).toEqual(["claimNext", "complete", "recordDelivered", "release"]);
  });
});
