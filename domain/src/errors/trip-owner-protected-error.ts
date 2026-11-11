import { TaggedError } from "../types/error.js";

/** The Trip owner cannot lose the admin role or be removed by someone else. */
export class TripOwnerProtectedError extends TaggedError<"TripOwnerProtectedError"> {
  constructor() {
    super("TripOwnerProtectedError");
    this.message = "The Trip owner is protected.";
  }
}
