import { TaggedError } from "../types/error.js";

export class InviteCodeConflictError extends TaggedError<"InviteCodeConflictError"> {
  constructor() {
    super("InviteCodeConflictError");
  }
}
