import { describe, expect, it } from "vitest";

import { getAuthenticatedProfile } from "./get-authenticated-profile.js";

describe("getAuthenticatedProfile", () => {
  it("returns only the authenticated user's public profile data", async () => {
    const result = await getAuthenticatedProfile.execute(
      {
        users: {
          findById: async () => ({
            ok: true,
            value: {
              id: "507f1f77bcf86cd799439011",
              email: "nico@example.test",
              name: "Nico",
              avatarS3Key: "avatars/nico.jpg",
              passwordHash: "bcrypt-hash",
              createdAt: new Date("2026-09-21T12:00:00.000Z"),
            },
          }),
        },
      } as never,
      { authenticatedUserId: "507f1f77bcf86cd799439011" } as never,
    );

    expect(result).toEqual({
      ok: true,
      value: {
        name: "Nico",
        email: "nico@example.test",
        avatar: "avatars/nico.jpg",
      },
    });
    expect(JSON.stringify(result)).not.toContain("bcrypt-hash");
  });
});
