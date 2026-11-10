import { TaggedError } from "../types/error.js";

export class PhotoNotFoundError extends TaggedError<"PhotoNotFoundError"> {
  constructor() { super("PhotoNotFoundError"); }
}
