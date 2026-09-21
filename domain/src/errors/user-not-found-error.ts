import { TaggedError } from "../types/error.js";

export class UserNotFoundError extends TaggedError<"UserNotFoundError"> {
  constructor() {
    super("UserNotFoundError");
    this.message = "User not found.";
  }
}
