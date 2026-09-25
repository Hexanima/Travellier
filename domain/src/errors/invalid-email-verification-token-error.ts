import { TaggedError } from "../types/error.js";

export class InvalidEmailVerificationTokenError extends TaggedError<"InvalidEmailVerificationTokenError"> {
  constructor() {
    super("InvalidEmailVerificationTokenError");
    this.message = "Email verification link is invalid or expired.";
  }
}
