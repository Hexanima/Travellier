import { describe, expect, it, vi } from "vitest";

import { getAvatarUrl } from "./get-avatar-url.js";

const userId = "507f1f77bcf86cd799439011";
const user = {
  id: userId, name: "Nico", email: "nico@example.test", passwordHash: "hash",
  avatarS3Key: `avatars/${userId}/unique-id.jpg`, createdAt: new Date(),
};

describe("getAvatarUrl", () => {
  it("signs a download only for the authenticated user's stored avatar", async () => {
    const createDownloadTarget = vi.fn().mockResolvedValue({ ok: true, value: { downloadUrl: "https://s3.example.test/view" } });
    const result = await getAvatarUrl.execute({
      users: { findById: vi.fn().mockResolvedValue({ ok: true, value: user }) },
      storage: { createDownloadTarget },
    } as never, { authenticatedUserId: userId } as never);

    expect(createDownloadTarget).toHaveBeenCalledWith({ objectKey: user.avatarS3Key, expiresInSeconds: 300 });
    expect(result).toEqual({ ok: true, value: { url: "https://s3.example.test/view" } });
  });

  it("returns null without signing when no avatar exists", async () => {
    const createDownloadTarget = vi.fn();
    const result = await getAvatarUrl.execute({
      users: { findById: vi.fn().mockResolvedValue({ ok: true, value: { ...user, avatarS3Key: null } }) },
      storage: { createDownloadTarget },
    } as never, { authenticatedUserId: userId } as never);

    expect(result).toEqual({ ok: true, value: { url: null } });
    expect(createDownloadTarget).not.toHaveBeenCalled();
  });
});
