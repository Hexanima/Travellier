import {
  PUSH_DISPATCH_LEASE_SECONDS,
  PUSH_DISPATCH_MAX_ATTEMPTS,
  PUSH_DISPATCH_MAX_DEVICES_PER_USER,
  PUSH_DISPATCH_VALIDITY_MS,
  buildPushMessage,
  computePushRetryDelay,
  type PushDispatchOutcome,
} from "../../entities/push-dispatch.js";
import type { PushProvider } from "../../entities/push-device.js";
import type { DispatchAudiencePort, PushDispatchClaim, PushDispatchPort, PushProviderPort } from "../../ports/push-dispatch-port.js";
import type { PushDeviceRepository } from "../../ports/push-device-port.js";
import { ok, type Result } from "../../types/result.js";
import { removeInvalidPushDevices } from "./remove-invalid-push-devices.js";

export interface DispatchPushNotificationsDeps {
  dispatch: PushDispatchPort;
  audience: DispatchAudiencePort;
  devices: Pick<PushDeviceRepository, "listForUser">;
  provider: PushProviderPort;
  removeInvalid: Pick<PushDeviceRepository, "removeInvalid">;
  now: () => Date;
  createOwner: () => string;
  deadline: Date;
  maxEvents: number;
}

/** Counters only: tokens, ids and raw errors are never reported. */
export interface PushDispatchRunSummary {
  claimed: number;
  /** Events completed as `sent/delivered`. */
  delivered: number;
  skipped: { expired: number; trip_deleted: number; not_member: number; rejoined: number };
  noDevices: number;
  /** Events whose devices were all invalid tokens (they were removed). */
  invalidOnly: number;
  /** Tokens the provider reported as invalid. */
  invalidTokens: number;
  /** Devices rejected permanently (configuration or payload); their token is kept. */
  rejected: number;
  /** Events released to retry after a transient failure. */
  transient: number;
  /** Of the events, those that ran out of attempts and stay `failed`. */
  exhausted: number;
  claimFailed: boolean;
  leaseLost: number;
}

type EventResult = "delivered" | "skipped" | "no_devices" | "invalid_only" | "retry" | "exhausted" | "deadline" | "failed" | "lease_lost";

/**
 * Pushes each persisted event to the current devices of its recipient. It revalidates the Trip and the membership at dispatch time,
 * is idempotent per (event, device) through `deliveredDeviceIds`, and never creates, edits or removes app notifications.
 */
export const dispatchPushNotifications = async (deps: DispatchPushNotificationsDeps): Promise<Result<PushDispatchRunSummary>> => {
  const summary: PushDispatchRunSummary = { claimed: 0, delivered: 0, skipped: { expired: 0, trip_deleted: 0, not_member: 0, rejoined: 0 },
    noDevices: 0, invalidOnly: 0, invalidTokens: 0, rejected: 0, transient: 0, exhausted: 0, claimFailed: false, leaseLost: 0 };
  const expired = () => deps.now().getTime() >= deps.deadline.getTime();

  const processEvent = async (claim: PushDispatchClaim, owner: string): Promise<EventResult> => {
    const release = async (code: string, mode: "retry" | "deadline" | "permanent"): Promise<EventResult> => {
      const now = deps.now();
      const counts = mode !== "deadline";
      // The attempt was already counted when the event was claimed: `claim.attempts` includes it.
      const exhausted = mode === "permanent" || (counts && claim.attempts >= PUSH_DISPATCH_MAX_ATTEMPTS);
      const nextAttemptAt = counts ? new Date(now.getTime() + computePushRetryDelay(claim.attempts)) : now;
      const released = await deps.dispatch.release(claim.id, owner, { nextAttemptAt, ...(counts ? {} : { refundAttempt: true }),
        status: exhausted ? "failed" : "pending", lastErrorCode: code });
      if (released.ok && !released.value) return "lease_lost";
      if (mode === "deadline") return "deadline";
      if (mode === "permanent") return "failed";
      return exhausted ? "exhausted" : "retry";
    };
    const complete = async (status: "sent" | "skipped", outcome: PushDispatchOutcome, result: EventResult): Promise<EventResult> => {
      const done = await deps.dispatch.complete(claim.id, owner, { status, outcome, now: deps.now() });
      if (!done.ok) return release("complete_failed", "retry");
      return done.value ? result : "lease_lost";
    };

    // Claims that died before finishing (lease expired) already used the attempts: past the maximum nothing is sent anymore.
    if (claim.attempts > PUSH_DISPATCH_MAX_ATTEMPTS) {
      const released = await deps.dispatch.release(claim.id, owner, { nextAttemptAt: deps.now(), status: "failed", lastErrorCode: "exhausted" });
      return released.ok && !released.value ? "lease_lost" : "exhausted";
    }
    if (deps.now().getTime() - claim.createdAt.getTime() > PUSH_DISPATCH_VALIDITY_MS) {
      summary.skipped.expired += 1;
      return complete("skipped", "expired", "skipped");
    }
    const exists = await deps.audience.tripExists(claim.tripId);
    if (!exists.ok) return release("audience_check_failed", "retry");
    if (!exists.value) { summary.skipped.trip_deleted += 1; return complete("skipped", "trip_deleted", "skipped"); }
    const member = await deps.audience.isCurrentMember(claim.tripId, claim.userId);
    if (!member.ok) return release("audience_check_failed", "retry");
    // An expulsion is only for someone who is out today; every other event only for someone who is still in.
    if (claim.type === "member.expelled" ? member.value : !member.value) {
      const outcome = claim.type === "member.expelled" ? "rejoined" : "not_member";
      summary.skipped[outcome] += 1;
      return complete("skipped", outcome, "skipped");
    }

    const listed = await deps.devices.listForUser(claim.userId);
    if (!listed.ok) return release("devices_unavailable", "retry");
    const devices = listed.value.slice(0, PUSH_DISPATCH_MAX_DEVICES_PER_USER);
    if (devices.length === 0) { summary.noDevices += 1; return complete("sent", "no_devices", "no_devices"); }

    const message = buildPushMessage(claim);
    const done = new Set<string>(claim.deliveredDeviceIds);
    const invalid = new Map<PushProvider, string[]>();
    let rejected = 0, transientCode = "", timedOut = false, saveFailed = false;
    for (const device of devices) {
      if (done.has(device.id)) continue;
      if (expired()) { timedOut = true; break; }
      const sent = await deps.provider.send({ device: { provider: device.provider, platform: device.platform, token: device.token }, message,
        dedupeId: `${claim.id}:${device.id}` });
      if (!sent.ok) { transientCode ||= "provider_error"; continue; }
      const result = sent.value;
      if (result.kind === "delivered") {
        done.add(device.id);
        const saved = await deps.dispatch.recordDelivered(claim.id, owner, device.id);
        if (!saved.ok) { saveFailed = true; break; }
        if (!saved.value) return "lease_lost";
      } else if (result.kind === "invalid_token") {
        invalid.set(device.provider, [...(invalid.get(device.provider) ?? []), device.token]);
        summary.invalidTokens += 1;
      } else if (result.kind === "transient") {
        transientCode ||= result.code;
      } else {
        rejected += 1;
        summary.rejected += 1;
      }
    }
    // One removal per provider; a failed removal only leaves the token for the next event to find invalid again.
    for (const [provider, tokens] of invalid) await removeInvalidPushDevices.execute({ pushDevices: deps.removeInvalid }, { provider, tokens });

    if (saveFailed) return release("progress_not_saved", "retry");
    if (transientCode !== "") return release(transientCode, "retry");
    if (timedOut) return release("deadline", "deadline");
    if (devices.some((device) => done.has(device.id))) { summary.delivered += 1; return complete("sent", "delivered", "delivered"); }
    if (rejected > 0) return release("rejected", "permanent");
    summary.invalidOnly += 1;
    return complete("sent", "invalid_only", "invalid_only");
  };

  while (summary.claimed < deps.maxEvents && !expired()) {
    const now = deps.now(), owner = deps.createOwner();
    const claimed = await deps.dispatch.claimNext({ now, leaseUntil: new Date(now.getTime() + PUSH_DISPATCH_LEASE_SECONDS * 1000), owner });
    if (!claimed.ok) { summary.claimFailed = true; break; }
    if (claimed.value === undefined) break;
    summary.claimed += 1;
    let result: EventResult;
    try {
      result = await processEvent(claimed.value, owner);
    } catch {
      // A poison event must not loop forever: the attempt is already counted; if releasing fails, the lease expiry frees it.
      try {
        const attempts = claimed.value.attempts, at = deps.now();
        const exhausted = attempts >= PUSH_DISPATCH_MAX_ATTEMPTS;
        const released = await deps.dispatch.release(claimed.value.id, owner, { nextAttemptAt: new Date(at.getTime() + computePushRetryDelay(attempts)),
          status: exhausted ? "failed" : "pending", lastErrorCode: "unexpected" });
        result = released.ok && !released.value ? "lease_lost" : exhausted ? "exhausted" : "retry";
      } catch { result = "retry"; }
    }
    if (result === "retry" || result === "exhausted") summary.transient += 1;
    if (result === "exhausted") summary.exhausted += 1;
    if (result === "lease_lost") summary.leaseLost += 1;
  }
  return ok(summary);
};
