import { describe, expect, it, vi } from "vitest";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

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

  it("signs ContentLength only when the upload size is supplied", async () => {
    const sign = vi.fn().mockResolvedValue("https://s3.example.test/upload");
    const storage = createS3ObjectStorage({ bucketName: "photos", sign });
    await storage.createUploadTarget({ objectKey: "a.jpg", contentType: "image/jpeg", expiresInSeconds: 900, contentLength: 1234 });
    await storage.createUploadTarget({ objectKey: "b.jpg", contentType: "image/jpeg", expiresInSeconds: 300 });

    expect(sign.mock.calls[0]?.[0].input).toEqual({ Bucket: "photos", Key: "a.jpg", ContentType: "image/jpeg", ContentLength: 1234 });
    expect(sign.mock.calls[1]?.[0].input).toEqual({ Bucket: "photos", Key: "b.jpg", ContentType: "image/jpeg" });
  });
});

describe("createS3ObjectStorage headObject", () => {
  const withClient = (send: ReturnType<typeof vi.fn>) =>
    createS3ObjectStorage({ bucketName: "photos", client: { send } as unknown as S3Client, sign: vi.fn() });
  const failure = (name: string, status?: number) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });

  it("reports the stored content type and size of an existing object", async () => {
    const send = vi.fn().mockResolvedValue({ ContentType: "image/png", ContentLength: 2048 });
    const result = await withClient(send).headObject({ objectKey: "trips/t/photos/u/id.png" });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadObjectCommand);
    expect(send.mock.calls[0]?.[0].input).toEqual({ Bucket: "photos", Key: "trips/t/photos/u/id.png" });
    expect(result).toEqual({ ok: true, value: { contentType: "image/png", sizeBytes: 2048 } });
  });

  it("returns null content type and zero size when S3 omits them", async () => {
    const result = await withClient(vi.fn().mockResolvedValue({})).headObject({ objectKey: "k" });
    expect(result).toEqual({ ok: true, value: { contentType: null, sizeBytes: 0 } });
  });

  it.each([["NotFound", 404], ["NoSuchKey", undefined], ["Other", 404]])("treats %s as a missing object", async (name, status) => {
    const result = await withClient(vi.fn().mockRejectedValue(failure(name, status))).headObject({ objectKey: "k" });
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it.each([["AccessDenied", 403], ["InternalError", 500], ["Error", undefined]])("fails with UnknownError on %s", async (name, status) => {
    const result = await withClient(vi.fn().mockRejectedValue(failure(name, status))).headObject({ objectKey: "k" });
    expect(result).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
    expect(JSON.stringify(result)).not.toContain("photos");
  });

  it("fails with UnknownError when the rejection is not an Error", async () => {
    const result = await withClient(vi.fn().mockRejectedValue("boom")).headObject({ objectKey: "k" });
    expect(result).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
  });
});
