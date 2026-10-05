import { TaggedError } from "../types/error.js";

export class PostNotFoundError extends TaggedError<"PostNotFoundError"> {
  constructor() { super("PostNotFoundError"); }
}
