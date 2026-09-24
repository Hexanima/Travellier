import { describe, expect, it, vi } from "vitest";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

import { createS3ObjectStorage } from "./s3-object-storage.js";

describe("createS3ObjectStorage", () => {
  it("signs a PUT for the exact avatar key and content type", async () => {
    const sign = vi.fn().mockResolvedValue("https://s3.example.test/upload");
    const storage = createS3ObjectStorage({ bucketName: "photos", sign });
    const result = await storage.createUploadTarget({
      objectKey: "avatars/user/id.jpg", contentType: "image/jpeg", expiresInSeconds: 300,
    });

    expect(sign.mock.calls[0]?.[0]).toBeInstanceOf(PutObjectCommand);
    expect(sign.mock.calls[0]?.[0].input).toMatchObject({ Bucket: "photos", Key: "avatars/user/id.jpg", ContentType: "image/jpeg" });
    expect(sign.mock.calls[0]?.[1]).toEqual({ expiresIn: 300 });
    expect(result).toMatchObject({ ok: true, value: { uploadUrl: "https://s3.example.test/upload", headers: { "content-type": "image/jpeg" } } });
  });

  it("signs a GET for the stored avatar key", async () => {
    const sign = vi.fn().mockResolvedValue("https://s3.example.test/view");
    const storage = createS3ObjectStorage({ bucketName: "photos", sign });
    const result = await storage.createDownloadTarget({ objectKey: "avatars/user/id.jpg", expiresInSeconds: 300 });

    expect(sign.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);
    expect(sign.mock.calls[0]?.[0].input).toMatchObject({ Bucket: "photos", Key: "avatars/user/id.jpg" });
    expect(result).toEqual({ ok: true, value: { downloadUrl: "https://s3.example.test/view" } });
  });
});
