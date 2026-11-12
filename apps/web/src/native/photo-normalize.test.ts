import { describe, expect, it, vi } from "vitest";
import { MAX_PHOTO_BYTES } from "../trips/photo-limits.js";
import type { ImageCodec } from "./image-codec.js";
import { normalizePhoto } from "./photo-normalize.js";

const MiB = 1024 * 1024;
const blobOf = (size: number, type: string) => new Blob([new Uint8Array(size)], { type });
type Attempt = { maxSide: number; quality: number };
/** Encoded sizes by attempt order; `undefined` answers an empty encode. */
function makeCodec(sizes: (number | undefined)[], decodeError?: Error) {
  const attempts: Attempt[] = [];
  const close = vi.fn();
  const codec: ImageCodec = {
    decode: vi.fn(async () => { if (decodeError) throw decodeError; return { width: 6000, height: 4000, close }; }),
    encode: vi.fn(async (_image, options) => {
      attempts.push(options);
      const size = sizes[attempts.length - 1];
      return size === undefined ? undefined : blobOf(size, "image/jpeg");
    }),
  };
  return { codec, attempts, close };
}
const ladder: Attempt[] = [{ maxSide: 4096, quality: 0.85 }, { maxSide: 4096, quality: 0.7 }, { maxSide: 3000, quality: 0.7 },
  { maxSide: 2048, quality: 0.7 }, { maxSide: 2048, quality: 0.5 }, { maxSide: 1600, quality: 0.5 }, { maxSide: 1024, quality: 0.5 }];

describe("normalizePhoto", () => {
  it("converts HEIC by mime type to JPEG capped at 4096 px with quality 0.9", async () => {
    const { codec, attempts, close } = makeCodec([2 * MiB]);
    const result = await normalizePhoto(blobOf(5, "image/heic"), undefined, codec);
    expect(result.ok && result.value.type).toBe("image/jpeg");
    expect(attempts).toEqual([{ maxSide: 4096, quality: 0.9 }]);
    expect(close).toHaveBeenCalledOnce();
  });
  it("detects HEIF/HEIC with an empty or octet-stream type by the native format", async () => {
    for (const type of ["", "application/octet-stream"]) {
      const { codec } = makeCodec([100]);
      const result = await normalizePhoto(blobOf(5, type), "heic", codec);
      expect(result.ok && result.value.type).toBe("image/jpeg");
      expect(codec.decode).toHaveBeenCalledOnce();
    }
  });
  it("detects HEIC by its ftyp magic bytes", async () => {
    const bytes = new Uint8Array(32); bytes.set(new TextEncoder().encode("ftypheic"), 4);
    const { codec } = makeCodec([100]);
    const result = await normalizePhoto(new Blob([bytes], { type: "application/octet-stream" }), undefined, codec);
    expect(result.ok && result.value.type).toBe("image/jpeg");
    const other = new Uint8Array(32); other.set(new TextEncoder().encode("ftypisom"), 4);
    const second = makeCodec([]);
    const passed = await normalizePhoto(new Blob([other], { type: "" }), "jpeg", second.codec);
    expect(passed.ok).toBe(true);
    expect(second.codec.decode).not.toHaveBeenCalled();
  });
  it("lets a 5 MiB JPEG through untouched without calling the codec", async () => {
    const { codec } = makeCodec([]);
    const input = blobOf(5 * MiB, "image/jpeg");
    const result = await normalizePhoto(input, "jpeg", codec);
    expect(result.ok && result.value).toBe(input);
    expect(codec.decode).not.toHaveBeenCalled();
  });
  it("shrinks a 12 MiB JPEG down the ladder until the first attempt that fits", async () => {
    const { codec, attempts, close } = makeCodec([11 * MiB, 10.5 * MiB, 9 * MiB, 1 * MiB]);
    const result = await normalizePhoto(blobOf(12 * MiB, "image/jpeg"), undefined, codec);
    expect(result.ok && result.value.size).toBe(9 * MiB);
    expect(attempts).toEqual(ladder.slice(0, 3));
    expect(codec.decode).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
  it("outputs a PNG over 10 MiB as JPEG", async () => {
    const { codec } = makeCodec([3 * MiB]);
    const result = await normalizePhoto(blobOf(11 * MiB, "image/png"), undefined, codec);
    expect(result.ok && result.value.type).toBe("image/jpeg");
  });
  it("shrinks a HEIC result that is still too big with the ladder", async () => {
    const { codec, attempts } = makeCodec([11 * MiB, 2 * MiB]);
    const result = await normalizePhoto(blobOf(5, "image/heif"), undefined, codec);
    expect(result.ok && result.value.size).toBe(2 * MiB);
    expect(attempts).toEqual([{ maxSide: 4096, quality: 0.9 }, ladder[0]]);
  });
  it("fails with size when no attempt fits, after trying the whole ladder in order", async () => {
    const { codec, attempts, close } = makeCodec(Array(10).fill(MAX_PHOTO_BYTES + 1));
    const result = await normalizePhoto(blobOf(12 * MiB, "image/webp"), undefined, codec);
    expect(result).toMatchObject({ ok: false, error: { reason: "size" } });
    expect(attempts).toEqual(ladder);
    expect(close).toHaveBeenCalledOnce();
  });
  it("fails with convert when decoding throws", async () => {
    const { codec } = makeCodec([], new Error("no decoder"));
    expect(await normalizePhoto(blobOf(5, "image/heic"), undefined, codec)).toMatchObject({ ok: false, error: { reason: "convert" } });
  });
  it("fails with convert when encoding returns nothing or throws, and still closes the bitmap", async () => {
    const empty = makeCodec([undefined]);
    expect(await normalizePhoto(blobOf(5, "image/heic"), undefined, empty.codec)).toMatchObject({ ok: false, error: { reason: "convert" } });
    expect(empty.close).toHaveBeenCalledOnce();
    const broken = makeCodec([]);
    vi.mocked(broken.codec.encode).mockRejectedValue(new Error("canvas"));
    expect(await normalizePhoto(blobOf(12 * MiB, "image/jpeg"), undefined, broken.codec)).toMatchObject({ ok: false, error: { reason: "convert" } });
    expect(broken.close).toHaveBeenCalledOnce();
  });
  it("rejects inputs over the memory cap with size without decoding", async () => {
    const { codec } = makeCodec([]);
    const huge = { size: 65 * MiB, type: "image/jpeg" } as Blob;
    expect(await normalizePhoto(huge, undefined, codec)).toMatchObject({ ok: false, error: { reason: "size" } });
    expect(codec.decode).not.toHaveBeenCalled();
  });
  it("does not touch unsupported types", async () => {
    const { codec } = makeCodec([]);
    const input = blobOf(12 * MiB, "image/gif");
    const result = await normalizePhoto(input, undefined, codec);
    expect(result.ok && result.value).toBe(input);
    expect(codec.decode).not.toHaveBeenCalled();
  });
});
