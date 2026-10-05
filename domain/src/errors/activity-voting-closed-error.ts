import { TaggedError } from "../types/error.js";

export class ActivityVotingClosedError extends TaggedError<"ActivityVotingClosedError"> {
  constructor() { super("ActivityVotingClosedError"); }
}
