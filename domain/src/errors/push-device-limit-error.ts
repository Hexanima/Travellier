import { TaggedError } from "../types/error.js";

/** The user already has the maximum of registered push devices. Carries no token data. */
export class PushDeviceLimitError extends TaggedError<"PushDeviceLimitError"> {
  readonly limit: number;

  constructor(limit: number) {
    super("PushDeviceLimitError");
    this.limit = limit;
    this.message = `The maximum of ${limit} push devices per user was reached.`;
  }
}
