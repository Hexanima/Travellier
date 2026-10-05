import { TaggedError } from "../types/error.js";

export class ActivityVotingDisabledError extends TaggedError<"ActivityVotingDisabledError"> {
  constructor() { super("ActivityVotingDisabledError"); }
}
