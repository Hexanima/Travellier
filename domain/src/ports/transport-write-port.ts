import type { Transport } from "../entities/transport.js";
import type { TaggedError } from "../types/error.js";
import type { AsyncResult } from "../types/result.js";

export interface TransportWritePort<TError extends TaggedError = TaggedError> {
  save: (transport: Transport) => AsyncResult<void, TError>;
}
