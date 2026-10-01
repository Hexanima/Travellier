import { createTransport, type CreateTransportInput, type Transport } from "../../entities/transport.js";
import type { TransportWritePort } from "../../ports/transport-write-port.js";
import type { TaggedError } from "../../types/error.js";
import { ok } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";

export interface SaveTransportDependencies {
  transports: TransportWritePort;
}

export const saveTransport: UseCase<SaveTransportDependencies, CreateTransportInput, Transport, TaggedError> = {
  execute: async ({ transports }, input) => {
    const validated = createTransport(input);
    if (!validated.ok) return validated;
    const result = await transports.save(validated.value);
    return result.ok ? ok(validated.value) : result;
  },
};
