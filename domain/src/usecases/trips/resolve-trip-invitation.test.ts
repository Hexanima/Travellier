import { describe, expect, it, vi } from "vitest";

import { resolveTripInvitation } from "./resolve-trip-invitation.js";

const tripId = "507f191e810c19729de860ea";

describe("resolveTripInvitation", () => {
  it("validates an existing code without joining a user", async () => {
    const findByInviteCode = vi.fn().mockResolvedValue({ ok: true, value: { id: tripId } });
    const result = await resolveTripInvitation.execute({ trips: { findByInviteCode } } as never, { code: "VIAJE-X7K2" });

    expect(findByInviteCode).toHaveBeenCalledWith("VIAJE-X7K2");
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("rejects an unknown code", async () => {
    const result = await resolveTripInvitation.execute({
      trips: { findByInviteCode: vi.fn().mockResolvedValue({ ok: true, value: undefined }) },
    } as never, { code: "MISSING" });

    expect(result).toMatchObject({ ok: false, error: { tag: "InvalidInviteCodeError" } });
  });

  it("rejects an empty code without querying trips", async () => {
    const findByInviteCode = vi.fn();
    const result = await resolveTripInvitation.execute({ trips: { findByInviteCode } } as never, { code: " " });

    expect(result).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(findByInviteCode).not.toHaveBeenCalled();
  });
});
