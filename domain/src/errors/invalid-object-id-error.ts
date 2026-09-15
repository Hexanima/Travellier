import { TaggedError } from "../types/error.js";

export class InvalidObjectIdError extends TaggedError<"InvalidObjectIdError"> {
  constructor(readonly value: string) {
    super("InvalidObjectIdError");
    this.message = "ObjectId must be a 24-character hexadecimal string.";
  }
}
