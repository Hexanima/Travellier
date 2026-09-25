import { TaggedError } from "../types/error.js";

export class TripNotFoundError extends TaggedError<"TripNotFoundError"> {
  constructor() {
    super("TripNotFoundError");
  }
}
