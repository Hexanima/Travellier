import type { ActivityStatus } from "../entities/activity.js";
import { ActivityVotingClosedError } from "../errors/activity-voting-closed-error.js";
import { err, ok, type Result } from "../types/result.js";

/** Confirmation stays here once a consensus rule is defined; vote counts do not confirm yet. */
export const transitionAfterActivityVote = (status: ActivityStatus): Result<ActivityStatus, ActivityVotingClosedError> =>
  status === "confirmed" ? err(new ActivityVotingClosedError()) : ok("voting");
