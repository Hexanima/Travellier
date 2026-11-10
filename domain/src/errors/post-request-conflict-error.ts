import { TaggedError } from "../types/error.js";

/**
 * The client-supplied id of a post save (or of its new activity) is already taken by something that is not this same request:
 * another Trip, another author, a different body or an activity not linked to the post. It never says which one.
 */
export class PostRequestConflictError extends TaggedError<"PostRequestConflictError"> {
  constructor() { super("PostRequestConflictError"); }
}
