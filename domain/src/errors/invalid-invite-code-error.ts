import { TaggedError } from "../types/error.js";

export class InvalidInviteCodeError extends TaggedError<"InvalidInviteCodeError"> {
  constructor() {
    super("InvalidInviteCodeError");
    this.message = "Invitation code not found.";
  }
}
