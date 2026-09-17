import { TaggedError } from "../types/error.js";

export class InvalidObjectIdError extends TaggedError<"InvalidObjectIdError"> {
  readonly value: string;

  constructor(value: string) {
    super("InvalidObjectIdError");
    this.value = value;
    this.message = "ObjectId must be a 24-character hexadecimal string.";
  }
}
