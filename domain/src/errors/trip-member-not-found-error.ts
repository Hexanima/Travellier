import { TaggedError } from "../types/error.js";

export class TripMemberNotFoundError extends TaggedError<"TripMemberNotFoundError"> {
  constructor() {
    super("TripMemberNotFoundError");
    this.message = "Trip member not found.";
  }
}
