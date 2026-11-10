import { describe, expect, it, vi } from "vitest";

import { joinTripByCode } from "./join-trip-by-code.js";
import { joinPublicTrip } from "./public-trips.js";

const userId = "507f1f77bcf86cd799439011";
const tripId = "507f191e810c19729de860ea";
const membershipId = "507f1f77bcf86cd799439021";
const others = ["507f1f77bcf86cd799439031", "507f1f77bcf86cd799439032"];
const now = () => new Date("2026-10-04T12:00:00.789Z");

describe("joinTripByCode", () => {
  it("adds the authenticated user as a participant of the invited trip", async () => {
    const findByInviteCode = vi.fn().mockResolvedValue({ ok: true, value: { id: tripId } });
    const addParticipant = vi.fn().mockResolvedValue({ ok: true, value: true });

    const result = await joinTripByCode.execute({ trips: { findByInviteCode }, members: { addParticipant }, now } as never, {
      authenticatedUserId: userId,
      code: "VIAJE-X7K2",
    } as never);

    expect(findByInviteCode).toHaveBeenCalledWith("VIAJE-X7K2");
    expect(addParticipant).toHaveBeenCalledWith(tripId, userId, expect.any(Function));
    expect(result).toEqual({ ok: true, value: { tripId, joined: true } });
  });

  it("rejects an unknown code without creating a membership", async () => {
    const addParticipant = vi.fn();
    const result = await joinTripByCode.execute({
      trips: { findByInviteCode: vi.fn().mockResolvedValue({ ok: true, value: undefined }) },
      members: { addParticipant }, now,
    } as never, { authenticatedUserId: userId, code: "missing" } as never);

    expect(result).toMatchObject({ ok: false, error: { tag: "InvalidInviteCodeError" } });
    expect(addParticipant).not.toHaveBeenCalled();
  });

  it("returns the existing membership without adding a duplicate", async () => {
    const result = await joinTripByCode.execute({
      trips: { findByInviteCode: vi.fn().mockResolvedValue({ ok: true, value: { id: tripId } }) },
      members: { addParticipant: vi.fn().mockResolvedValue({ ok: true, value: false }) }, now,
    } as never, { authenticatedUserId: userId, code: "VIAJE-X7K2" } as never);

    expect(result).toEqual({ ok: true, value: { tripId, joined: false } });
  });

  describe("member.joined notice (T91)", () => {
    const joinNoticeBuilder = async (run: (members: unknown) => Promise<unknown>) => {
      const addParticipant = vi.fn().mockResolvedValue({ ok: true, value: true });
      const addPublicParticipant = vi.fn().mockResolvedValue({ ok: true, value: true });
      await run({ addParticipant, addPublicParticipant });
      const call = (addParticipant.mock.calls[0] ?? addPublicParticipant.mock.calls[0]) as [string, string, (info: unknown) => unknown];
      return call[2];
    };
    const expected = others.map((recipient) => ({ eventKey: `member.joined:${membershipId}:${recipient}`, type: "member.joined", tripId, userId: recipient,
      actorId: userId, operationKey: `member.joined:${membershipId}`, payload: { memberId: membershipId, userId }, createdAt: now() }));

    it.each([
      ["by invitation code", (members: unknown) => joinTripByCode.execute({ trips: { findByInviteCode: vi.fn().mockResolvedValue({ ok: true, value: { id: tripId } }) }, members, now } as never,
        { authenticatedUserId: userId, code: "VIAJE-X7K2" } as never)],
      ["to a public Trip", (members: unknown) => joinPublicTrip.execute({ members, now } as never, { authenticatedUserId: userId, tripId } as never)],
    ])("builds one notice per other member %s, never for who joined", async (_label, run) => {
      const builder = await joinNoticeBuilder(run);
      expect(builder({ membershipId, memberUserIds: [userId, ...others, others[0]] })).toEqual(expected);
      expect(builder({ membershipId, memberUserIds: [userId] })).toEqual([]);
    });
  });
});
