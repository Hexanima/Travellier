import { TaggedError } from "../types/error.js";

export class DeletionConflictError extends TaggedError<"DeletionConflictError"> {
  constructor() { super("DeletionConflictError"); }
}

export class LastDestinationError extends TaggedError<"LastDestinationError"> {
  constructor() { super("LastDestinationError"); }
}
