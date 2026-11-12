import { describe, expect, it, vi } from "vitest";
import { MAX_PHOTO_BYTES } from "../trips/photo-limits.js";
import type { ImageCodec } from "./image-codec.js";
import { createPhotoFileReader } from "./photo-file.js";

const blobOf = (size: number, type: string) => new Blob([new Uint8Array(size)], { type });
const setup = (response: Response | Error, convertFileSrc = vi.fn((reference: string) => `https://converted/${reference}`), codec?: ImageCodec) => {
  const fetch = vi.fn().mockImplementation(async () => { if (response instanceof Error) throw response; return response; });
  return { reader: createPhotoFileReader({ fetch, convertFileSrc, ...(codec ? { codec } : {}) }), fetch, convertFileSrc };
};

describe("photo file reader", () => {
  it("fetches the preview url and returns the blob with its size and normalized type", async () => {
    const { reader, fetch, convertFileSrc } = setup(new Response(blobOf(12, "image/jpeg")));
    const result = await reader.read({ reference: "file:///a.jpg", previewUrl: "https://localhost/_capacitor_file_/a.jpg", format: "jpeg" });
    expect(fetch).toHaveBeenCalledExactlyOnceWith("https://localhost/_capacitor_file_/a.jpg");
    expect(convertFileSrc).not.toHaveBeenCalled();
    expect(result.ok && result.value.size).toBe(12);
    expect(result.ok && result.value.type).toBe("image/jpeg");
  });
  it("uses the injected convertFileSrc when there is no preview url", async () => {
    const { reader, fetch, convertFileSrc } = setup(new Response(blobOf(3, "image/png")));
    const result = await reader.read({ reference: "file:///b.png" });
    expect(convertFileSrc).toHaveBeenCalledExactlyOnceWith("file:///b.png");
    expect(fetch).toHaveBeenCalledExactlyOnceWith("https://converted/file:///b.png");
    expect(result.ok && result.value.type).toBe("image/png");
  });
  it("falls back to the native format when the blob has no usable type, normalizing jpg", async () => {
    const { reader } = setup(new Response(blobOf(3, "")));
    const result = await reader.read({ reference: "x", previewUrl: "https://p/x", format: "jpg" });
    expect(result.ok && result.value.type).toBe("image/jpeg");
  });
  it("rejects other types, empty and oversized blobs without returning them", async () => {
    const read = async (blob: Blob, format?: string) => (await setup(new Response(blob)).reader.read({ reference: "x", previewUrl: "https://p/x", ...(format ? { format } : {}) }));
    expect(await read(blobOf(5, "image/gif"))).toMatchObject({ ok: false, error: { reason: "type" } });
    expect(await read(blobOf(MAX_PHOTO_BYTES + 1, "image/jpeg"))).toMatchObject({ ok: false, error: { reason: "size" } });
    expect(await read(blobOf(0, "image/jpeg"))).toMatchObject({ ok: false, error: { reason: "size" } });
  });
  it("converts HEIC to JPEG with the codec and reports a codec failure as convert", async () => {
    const image = { width: 10, height: 10, close: vi.fn() };
    const codec: ImageCodec = { decode: vi.fn(async () => image), encode: vi.fn(async () => blobOf(7, "image/jpeg")) };
    const photo = { reference: "x", previewUrl: "https://p/x" };
    const converted = await setup(new Response(blobOf(5, "image/heic")), undefined, codec).reader.read(photo);
    expect(converted.ok && converted.value.type).toBe("image/jpeg");
    expect(converted.ok && converted.value.size).toBe(7);
    const failing: ImageCodec = { decode: vi.fn(async () => { throw new Error("no"); }), encode: vi.fn() };
    expect(await setup(new Response(blobOf(5, "")), undefined, failing).reader.read({ ...photo, format: "heic" })).toMatchObject({ ok: false, error: { reason: "convert" } });
  });
  it("without a codec a HEIC photo is refused as before", async () => {
    expect(await setup(new Response(blobOf(5, "image/heic"))).reader.read({ reference: "x", previewUrl: "https://p/x" })).toMatchObject({ ok: false, error: { reason: "type" } });
  });
  it("reports a read failure for a network error and for a non-2xx answer", async () => {
    expect(await setup(new Error("boom")).reader.read({ reference: "x", previewUrl: "https://p/x" })).toMatchObject({ ok: false, error: { reason: "read" } });
    expect(await setup(new Response("no", { status: 404 })).reader.read({ reference: "x", previewUrl: "https://p/x" })).toMatchObject({ ok: false, error: { reason: "read" } });
  });
});
