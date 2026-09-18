import { TaggedError } from "../types/error.js";

export class SessionExpiredError extends TaggedError<"SessionExpiredError"> {
  constructor() {
    super("SessionExpiredError");
    this.message = "Session has expired.";
  }
}
