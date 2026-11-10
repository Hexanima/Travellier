import type { PushProvider } from "../../entities/push-device.js";
import type { PushDeviceRepository } from "../../ports/push-device-port.js";
import type { TaggedError } from "../../types/error.js";
import { ok, type AsyncResult } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";

/** Removes tokens the provider reported as invalid (consumed by the dispatcher of T92; not an HTTP endpoint). */
export const removeInvalidPushDevices: UseCase<{ pushDevices: Pick<PushDeviceRepository, "removeInvalid"> }, { provider: PushProvider; tokens: readonly string[] }, number, TaggedError> = {
  execute: async ({ pushDevices }, { provider, tokens }): AsyncResult<number, TaggedError> => {
    const unique = [...new Set(tokens.map((token) => token.trim()).filter((token) => token.length > 0))];
    if (unique.length === 0) return ok(0);
    return pushDevices.removeInvalid(provider, unique);
  },
};
