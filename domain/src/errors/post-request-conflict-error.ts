import type { ObjectId } from "../value-objects/object-id.js";
import { TaggedError } from "../types/error.js";

/** The memory of this id is the requester's own, in this Trip, and was already saved (possibly changed afterwards). */
export interface AlreadySavedDetail { reason: "already_saved"; postId: ObjectId }

/**
 * The client-supplied id of a post save (or of its new activity) is already taken by something that is not this same request:
 * another Trip, another author, a different body or an activity not linked to the post. It never says which one, with one exception:
 * `already_saved` (with the post id) is only given for the requester's own post of this Trip, whose body no longer matches
 * (e.g. someone edited it after the first save): the client must not republish with another id.
 */
export class PostRequestConflictError extends TaggedError<"PostRequestConflictError"> {
  declare readonly reason?: "already_saved";
  declare readonly postId?: ObjectId;
  constructor(detail?: AlreadySavedDetail) {
    super("PostRequestConflictError");
    if (detail) Object.assign(this, detail);
  }
}
