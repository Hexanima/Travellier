import { TaggedError } from "../types/error.js";

export class InvalidCredentialsError extends TaggedError<"InvalidCredentialsError"> {
  constructor() {
    super("InvalidCredentialsError");
    this.message = "Invalid credentials.";
  }
}
