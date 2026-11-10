import { TaggedError } from "../types/error.js";

export class CommentNotFoundError extends TaggedError<"CommentNotFoundError"> {
  constructor() { super("CommentNotFoundError"); }
}
