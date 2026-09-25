import { TaggedError } from "../types/error.js";

export class InvalidSessionError extends TaggedError<"InvalidSessionError"> {
  constructor() {
    super("InvalidSessionError");
    this.message = "Session is invalid or has been revoked.";
  }
}
