import { TaggedError } from "../types/error.js";

export class ItineraryConflictError extends TaggedError<"ItineraryConflictError"> {
  constructor() { super("ItineraryConflictError"); }
}
