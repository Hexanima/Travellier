import { describe, expect, it, vi } from "vitest";

import { updateAuthenticatedProfile } from "./update-authenticated-profile.js";

describe("updateAuthenticatedProfile", () => {
  it("rejects an avatar key outside the authenticated user's prefix", async () => {
    const updateProfile = vi.fn();
    const result = await updateAuthenticatedProfile.execute({ users: { updateProfile } } as never, {
      authenticatedUserId: "507f1f77bcf86cd799439011",
      avatar: "avatars/507f191e810c19729de860ea/other.jpg",
    } as never);

    expect(result).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(updateProfile).not.toHaveBeenCalled();
  });
  it("updates only the profile identified by the authenticated user", async () => {
    const updateProfile = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        id: "507f1f77bcf86cd799439011",
        email: "nico@example.test",
        name: "Nicolás",
        avatarS3Key: "avatars/507f1f77bcf86cd799439011/nicolas.jpg",
        passwordHash: "bcrypt-hash",
        createdAt: new Date("2026-09-21T12:00:00.000Z"),
      },
    });

    const result = await updateAuthenticatedProfile.execute(
      { users: { updateProfile } } as never,
      {
        authenticatedUserId: "507f1f77bcf86cd799439011",
        name: "Nicolás",
        avatar: "avatars/507f1f77bcf86cd799439011/nicolas.jpg",
      } as never,
    );

    expect(updateProfile).toHaveBeenCalledWith("507f1f77bcf86cd799439011", {
      name: "Nicolás",
      avatarS3Key: "avatars/507f1f77bcf86cd799439011/nicolas.jpg",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        name: "Nicolás",
        email: "nico@example.test",
        avatar: "avatars/507f1f77bcf86cd799439011/nicolas.jpg",
      },
    });
  });

  it("rejects an empty name without persisting the profile", async () => {
    const updateProfile = vi.fn();

    const result = await updateAuthenticatedProfile.execute(
      { users: { updateProfile } } as never,
      {
        authenticatedUserId: "507f1f77bcf86cd799439011",
        name: "   ",
      } as never,
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        tag: "ValidationError",
        issues: [{ field: "name", code: "required" }],
      },
    });
    expect(updateProfile).not.toHaveBeenCalled();
  });
});
