import type { PushDevice, PushPlatform, PushProvider } from "../entities/push-device.js";
import type { AsyncResult } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

export interface RegisterPushDeviceInput {
  userId: ObjectId;
  provider: PushProvider;
  platform: PushPlatform;
  token: string;
  now: Date;
  /** Maximum of devices of the user; it applies only to a new document: at the limit the oldest own devices are evicted. */
  limit: number;
}

/**
 * Persistence of push device tokens. Errors never carry the token.
 * Revocations are idempotent: a missing or foreign device is also a success.
 */
export interface PushDeviceRepository {
  /** Atomic upsert by (provider, token). A token of another user is reassigned to the caller without counting against the limit. */
  register: (input: RegisterPushDeviceInput) => AsyncResult<{ device: PushDevice; created: boolean }>;
  revokeById: (userId: ObjectId, id: ObjectId) => AsyncResult<void>;
  revokeByToken: (userId: ObjectId, provider: PushProvider, token: string) => AsyncResult<void>;
  /** Devices of the user with their raw token, for the dispatcher (T92). Not exposed over HTTP. */
  listForUser: (userId: ObjectId) => AsyncResult<PushDevice[]>;
  /** Removes tokens the provider reported as invalid, whoever owns them; returns how many were removed. Not exposed over HTTP. */
  removeInvalid: (provider: PushProvider, tokens: readonly string[]) => AsyncResult<number>;
}
