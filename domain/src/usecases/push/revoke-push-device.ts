import { ValidationError } from "../../errors/validation-error.js";
import { validatePushTokenReference } from "../../entities/push-device.js";
import type { PushDeviceRepository } from "../../ports/push-device-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, type AsyncResult } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import { createObjectId, type ObjectId } from "../../value-objects/object-id.js";

/** Idempotent: a missing, foreign or already revoked device is also a success. Only the caller's own device is removed. */
export const revokePushDevice: UseCase<{ pushDevices: Pick<PushDeviceRepository, "revokeById"> }, { userId: ObjectId; deviceId: string }, void, TaggedError> = {
  execute: async ({ pushDevices }, { userId, deviceId }): AsyncResult<void, TaggedError> => {
    const id = createObjectId(deviceId);
    if (!id.ok) return err(new ValidationError([{ field: "id", code: "invalid", message: "Device id must be a valid identifier." }]));
    return pushDevices.revokeById(userId, id.value);
  },
};

export const revokePushDeviceByToken: UseCase<{ pushDevices: Pick<PushDeviceRepository, "revokeByToken"> }, { userId: ObjectId; input: unknown }, void, TaggedError> = {
  execute: async ({ pushDevices }, { userId, input }): AsyncResult<void, TaggedError> => {
    const reference = validatePushTokenReference(input);
    if (!reference.ok) return err(reference.error);
    return pushDevices.revokeByToken(userId, reference.value.provider, reference.value.token);
  },
};
