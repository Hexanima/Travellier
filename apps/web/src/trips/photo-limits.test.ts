import { describe, expect, it } from "vitest";
import { MAX_PHOTOS, isConvertibleInput, MAX_PHOTO_BYTES, normalizeContentType, photoRejectionMessage, validatePhoto } from "./photo-limits.js";

describe("photo limits", () => {
  it("matches the server limits", () => {
    expect(MAX_PHOTOS).toBe(10);
    expect(MAX_PHOTO_BYTES).toBe(10 * 1024 * 1024);
  });
  it("normalizes formats and mime types, turning jpg into image/jpeg", () => {
    expect(normalizeContentType("jpg")).toBe("image/jpeg");
    expect(normalizeContentType("JPEG")).toBe("image/jpeg");
    expect(normalizeContentType("image/jpg")).toBe("image/jpeg");
    expect(normalizeContentType("image/png")).toBe("image/png");
    expect(normalizeContentType(" webp ")).toBe("image/webp");
    expect(normalizeContentType("heic")).toBe("image/heic");
    expect(normalizeContentType("")).toBeUndefined();
    expect(normalizeContentType(undefined)).toBeUndefined();
  });
  it("accepts jpeg, png and webp up to exactly 10 MiB", () => {
    expect(validatePhoto("image/jpeg", MAX_PHOTO_BYTES)).toEqual({ ok: true, contentType: "image/jpeg" });
    expect(validatePhoto("png", 1)).toEqual({ ok: true, contentType: "image/png" });
    expect(validatePhoto("image/webp", 5)).toEqual({ ok: true, contentType: "image/webp" });
  });
  it("accepts HEIC and HEIF as convertible input but not as a final output", () => {
    expect(isConvertibleInput("image/heic")).toBe(true);
    expect(isConvertibleInput("heif")).toBe(true);
    expect(isConvertibleInput("image/png")).toBe(true);
    expect(isConvertibleInput("image/gif")).toBe(false);
    expect(isConvertibleInput(undefined)).toBe(false);
    expect(validatePhoto("image/heic", 5)).toEqual({ ok: false, reason: "type" });
    expect(photoRejectionMessage("convert")).toBe("No pudimos convertir o reducir esta foto. Quitala o elegí otra.");
  });
  it("rejects other types, unknown types, empty and oversized files", () => {
    expect(validatePhoto("image/gif", 5)).toEqual({ ok: false, reason: "type" });
    expect(validatePhoto(undefined, 5)).toEqual({ ok: false, reason: "type" });
    expect(validatePhoto("image/jpeg", MAX_PHOTO_BYTES + 1)).toEqual({ ok: false, reason: "size" });
    expect(validatePhoto("image/jpeg", 0)).toEqual({ ok: false, reason: "size" });
    expect(photoRejectionMessage("size")).toContain("10 MB");
    expect(photoRejectionMessage("type")).not.toBe(photoRejectionMessage("size"));
  });
});
