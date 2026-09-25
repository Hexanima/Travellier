import { describe, expect, it, vi } from "vitest";

import { joinTripByCode } from "./join-trip-by-code.js";

const userId = "507f1f77bcf86cd799439011";
const tripId = "507f191e810c19729de860ea";

describe("joinTripByCode", () => {
  it("adds the authenticated user as a participant of the invited trip", async () => {
    const findByInviteCode = vi.fn().mockResolvedValue({ ok: true, value: { id: tripId } });
    const addParticipant = vi.fn().mockResolvedValue({ ok: true, value: true });

    const result = await joinTripByCode.execute({ trips: { findByInviteCode }, members: { addParticipant } } as never, {
      authenticatedUserId: userId,
      code: "VIAJE-X7K2",
    } as never);

    expect(findByInviteCode).toHaveBeenCalledWith("VIAJE-X7K2");
    expect(addParticipant).toHaveBeenCalledWith(tripId, userId);
    expect(result).toEqual({ ok: true, value: { tripId, joined: true } });
  });

  it("rejects an unknown code without creating a membership", async () => {
    const addParticipant = vi.fn();
    const result = await joinTripByCode.execute({
      trips: { findByInviteCode: vi.fn().mockResolvedValue({ ok: true, value: undefined }) },
      members: { addParticipant },
    } as never, { authenticatedUserId: userId, code: "missing" } as never);

    expect(result).toMatchObject({ ok: false, error: { tag: "InvalidInviteCodeError" } });
    expect(addParticipant).not.toHaveBeenCalled();
  });

  it("returns the existing membership without adding a duplicate", async () => {
    const result = await joinTripByCode.execute({
      trips: { findByInviteCode: vi.fn().mockResolvedValue({ ok: true, value: { id: tripId } }) },
      members: { addParticipant: vi.fn().mockResolvedValue({ ok: true, value: false }) },
    } as never, { authenticatedUserId: userId, code: "VIAJE-X7K2" } as never);

    expect(result).toEqual({ ok: true, value: { tripId, joined: false } });
  });
});
