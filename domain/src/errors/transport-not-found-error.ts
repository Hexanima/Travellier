import { TaggedError } from "../types/error.js";

export class TransportNotFoundError extends TaggedError<"TransportNotFoundError"> {
  constructor() { super("TransportNotFoundError"); }
}
