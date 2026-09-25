import { TaggedError } from "../types/error.js";

export class EmailAlreadyRegisteredError extends TaggedError<"EmailAlreadyRegisteredError"> {
  constructor() {
    super("EmailAlreadyRegisteredError");
    this.message = "An account with this email already exists.";
  }
}
