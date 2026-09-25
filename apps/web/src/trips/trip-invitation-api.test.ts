import { describe, expect, it, vi } from "vitest";

import { createTripInvitationApi } from "./trip-invitation-api.js";

describe("createTripInvitationApi", () => {
  it("posts the invitation code with the authenticated client", async () => {
    const post = vi.fn().mockResolvedValue({ ok: true, value: { tripId: "507f191e810c19729de860ea", joined: true } });
    const api = createTripInvitationApi({ post } as never);

    expect(await api.joinByCode("VIAJE-X7K2")).toEqual({ ok: true, value: { tripId: "507f191e810c19729de860ea", joined: true } });
    expect(post).toHaveBeenCalledWith("/trips/join", { code: "VIAJE-X7K2" });
  });

  it("passes an unknown code back to the invitation screen", async () => {
    const post = vi.fn().mockResolvedValue({ ok: false, error: { kind: "not-found" } });
    const api = createTripInvitationApi({ post } as never);

    expect(await api.joinByCode("missing")).toEqual({ ok: false, error: { kind: "not-found" } });
  });
});
