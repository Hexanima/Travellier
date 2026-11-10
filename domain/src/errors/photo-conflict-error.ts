import { TaggedError } from "../types/error.js";

/** A photo key is already registered in another post. */
export class PhotoConflictError extends TaggedError<"PhotoConflictError"> {
  constructor() { super("PhotoConflictError"); }
}
