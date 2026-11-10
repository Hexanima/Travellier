import type { PushDevice, PushPlatform, PushProvider } from "../entities/push-device.js";
import type { AsyncResult } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

export interface RegisterPushDeviceInput {
  userId: ObjectId;
  provider: PushProvider;
  platform: PushPlatform;
  token: string;
  now: Date;
  /** Maximum of devices of the user; it applies only when the token was not already theirs. */
  limit: number;
}

/**
 * Persistence of push device tokens. Errors never carry the token.
 * Revocations are idempotent: a missing or foreign device is also a success.
 */
export interface PushDeviceRepository {
  /** Atomic upsert by (provider, token). A token of another user is reassigned to the caller, who bears the limit. */
  register: (input: RegisterPushDeviceInput) => AsyncResult<{ device: PushDevice; created: boolean }>;
  revokeById: (userId: ObjectId, id: ObjectId) => AsyncResult<void>;
  revokeByToken: (userId: ObjectId, provider: PushProvider, token: string) => AsyncResult<void>;
  /** Removes tokens the provider reported as invalid, whoever owns them; returns how many were removed. Not exposed over HTTP. */
  removeInvalid: (provider: PushProvider, tokens: readonly string[]) => AsyncResult<number>;
}
