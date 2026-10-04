import { TaggedError } from "../types/error.js";

export class DestinationNotFoundError extends TaggedError<"DestinationNotFoundError"> {
  constructor() { super("DestinationNotFoundError"); }
}
