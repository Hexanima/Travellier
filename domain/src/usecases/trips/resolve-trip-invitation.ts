import { InvalidInviteCodeError } from "../../errors/invalid-invite-code-error.js";
import { ValidationError } from "../../errors/validation-error.js";
import type { TripInvitationRepository } from "../../ports/trip-invitation-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, ok } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";

export interface ResolveTripInvitationPayload {
  code: string;
}

export const resolveTripInvitation: UseCase<
  { trips: TripInvitationRepository },
  ResolveTripInvitationPayload,
  void,
  TaggedError
> = {
  execute: async ({ trips }, { code }) => {
    if (code.trim() === "") {
      return err(new ValidationError([{ field: "code", code: "required", message: "Invitation code is required." }]));
    }
    const found = await trips.findByInviteCode(code);
    if (!found.ok) return found;
    return found.value === undefined ? err(new InvalidInviteCodeError()) : ok(undefined);
  },
};
