import { TaggedError } from "../types/error.js";

export class JourneyConflictError extends TaggedError<"JourneyConflictError"> {
  constructor() { super("JourneyConflictError"); }
}
