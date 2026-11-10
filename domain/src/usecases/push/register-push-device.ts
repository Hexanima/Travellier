import { maskPushToken, MAX_PUSH_DEVICES_PER_USER, validatePushDeviceInput, type PushDevice, type PushPlatform, type PushProvider } from "../../entities/push-device.js";
import type { PushDeviceRepository } from "../../ports/push-device-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, ok, type AsyncResult } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";

/** What the API returns about a device: never the token. */
export interface PushDeviceView {
  id: ObjectId;
  provider: PushProvider;
  platform: PushPlatform;
  tokenHint: string;
  registeredAt: Date;
}

export const toPushDeviceView = (device: PushDevice): PushDeviceView => ({
  id: device.id,
  provider: device.provider,
  platform: device.platform,
  tokenHint: maskPushToken(device.token),
  registeredAt: device.lastRegisteredAt,
});

export interface RegisterPushDevicePayload {
  userId: ObjectId;
  /** Untrusted body: only provider, platform and token are read. */
  input: unknown;
  now: Date;
}

export const registerPushDevice: UseCase<{ pushDevices: Pick<PushDeviceRepository, "register"> }, RegisterPushDevicePayload, PushDeviceView, TaggedError> = {
  execute: async ({ pushDevices }, { userId, input, now }): AsyncResult<PushDeviceView, TaggedError> => {
    const validated = validatePushDeviceInput(input);
    if (!validated.ok) return err(validated.error);
    const registered = await pushDevices.register({ userId, ...validated.value, now, limit: MAX_PUSH_DEVICES_PER_USER });
    if (!registered.ok) return registered;
    return ok(toPushDeviceView(registered.value.device));
  },
};
