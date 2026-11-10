import type { PushDispatchOutcome, PushMessage, PushableEvent } from "../entities/push-dispatch.js";
import type { PushPlatform, PushProvider } from "../entities/push-device.js";
import type { AsyncResult } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

/** An `outboxEvents` document leased by a worker: one event for one recipient. */
export type PushDispatchClaim = PushableEvent & {
  /** Recipient. */
  userId: ObjectId;
  createdAt: Date;
  /** Attempts counted so far, INCLUDING this claim: `claimNext` adds it atomically, so a worker that dies still consumed one. */
  attempts: number;
  /** Devices that already received this event: the idempotency key per (event, device). */
  deliveredDeviceIds: ObjectId[];
};

export interface PushDispatchCompletion {
  status: "sent" | "skipped";
  outcome: PushDispatchOutcome;
  now: Date;
}

export interface PushDispatchRelease {
  nextAttemptAt: Date;
  /** Gives back the attempt counted at claim time (the work was cut by the deadline, not a failure). */
  refundAttempt?: boolean;
  status: "pending" | "failed";
  lastErrorCode: string;
}

/**
 * Dispatch state of the persisted events (T91 documents, additive fields). Every write after `claimNext` is filtered by `leaseOwner`,
 * so a worker whose lease expired cannot overwrite the progress of the worker that reclaimed the event; they answer `false` then.
 * An event is never deleted and the dispatch never creates or removes app notifications.
 */
export interface PushDispatchPort {
  /** Atomically leases the next eligible event (`pending`, `availableAt <= now`, no live lease) and counts the attempt (`$inc`). */
  claimNext: (input: { now: Date; leaseUntil: Date; owner: string }) => AsyncResult<PushDispatchClaim | undefined>;
  /** Adds the device to `deliveredDeviceIds` (idempotent). */
  recordDelivered: (eventId: ObjectId, owner: string, deviceId: ObjectId) => AsyncResult<boolean>;
  complete: (eventId: ObjectId, owner: string, input: PushDispatchCompletion) => AsyncResult<boolean>;
  release: (eventId: ObjectId, owner: string, input: PushDispatchRelease) => AsyncResult<boolean>;
}

/** Current state of the Trip, read when dispatching (not when the event was persisted). */
export interface DispatchAudiencePort {
  isCurrentMember: (tripId: ObjectId, userId: ObjectId) => AsyncResult<boolean>;
  tripExists: (tripId: ObjectId) => AsyncResult<boolean>;
}

export interface PushProviderDevice {
  provider: PushProvider;
  platform: PushPlatform;
  /** Raw provider token: never logged nor placed in an error. */
  token: string;
}

export type PushSendResult =
  | { kind: "delivered" }
  /** The provider says the token no longer works: the device is removed. */
  | { kind: "invalid_token" }
  /** Worth retrying later. `code` is a short identifier, never a provider message. */
  | { kind: "transient"; code: string }
  /** Permanent for this device (configuration or payload); the token is NOT removed. */
  | { kind: "rejected"; code: string };

export interface PushProviderPort {
  /** `dedupeId` is stable per (event, device). */
  send: (input: { device: PushProviderDevice; message: PushMessage; dedupeId: string }) => AsyncResult<PushSendResult>;
}
