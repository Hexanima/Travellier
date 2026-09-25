import { describe, expect, it, vi } from "vitest";

import { createAvatarUpload } from "./create-avatar-upload.js";

const userId = "507f1f77bcf86cd799439011";

describe("createAvatarUpload", () => {
  it("signs an upload under the authenticated user's avatar prefix", async () => {
    const createUploadTarget = vi.fn().mockResolvedValue({
      ok: true,
      value: { uploadUrl: "https://s3.example.test/upload", headers: { "content-type": "image/jpeg" }, expiresAt: new Date("2026-09-23T12:05:00Z") },
    });

    const result = await createAvatarUpload.execute({
      storage: { createUploadTarget },
      createId: () => "unique-id",
    } as never, { authenticatedUserId: userId, contentType: "image/jpeg" } as never);

    expect(createUploadTarget).toHaveBeenCalledWith({
      objectKey: `avatars/${userId}/unique-id.jpg`,
      contentType: "image/jpeg",
      expiresInSeconds: 300,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        avatar: `avatars/${userId}/unique-id.jpg`,
        uploadUrl: "https://s3.example.test/upload",
        headers: { "content-type": "image/jpeg" },
        expiresAt: new Date("2026-09-23T12:05:00Z"),
      },
    });
  });

  it("rejects unsupported content types before signing", async () => {
    const createUploadTarget = vi.fn();
    const result = await createAvatarUpload.execute({ storage: { createUploadTarget }, createId: () => "id" } as never, {
      authenticatedUserId: userId,
      contentType: "image/svg+xml",
    } as never);

    expect(result).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(createUploadTarget).not.toHaveBeenCalled();
  });
});
