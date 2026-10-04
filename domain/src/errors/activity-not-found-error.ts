import { TaggedError } from "../types/error.js";

export class ActivityNotFoundError extends TaggedError<"ActivityNotFoundError"> {
  constructor() { super("ActivityNotFoundError"); }
}
