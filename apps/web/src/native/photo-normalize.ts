import { err, ok, type AsyncResult } from "app-domain";
import { MAX_PHOTO_BYTES, normalizeContentType } from "../trips/photo-limits.js";
import type { DecodedImage, ImageCodec } from "./image-codec.js";
import { PhotoReadError } from "./photo-error.js";

/** Technical limits of T129 (adjustable): memory guard for the input, cap for HEIC conversions and the shrink ladder of (long side, quality). */
const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const HEIC_ATTEMPT = { maxSide: 4096, quality: 0.9 };
const LADDER = [{ maxSide: 4096, quality: 0.85 }, { maxSide: 4096, quality: 0.7 }, { maxSide: 3000, quality: 0.7 }, { maxSide: 2048, quality: 0.7 },
  { maxSide: 2048, quality: 0.5 }, { maxSide: 1600, quality: 0.5 }, { maxSide: 1024, quality: 0.5 }] as const;
const reducible = new Set(["image/jpeg", "image/png", "image/webp"]);
const heicBrands = new Set(["heic", "heix", "mif1", "msf1", "heif"]);
const unusable = (type: string | undefined) => !type || type === "application/octet-stream";
const isHeicType = (type: string | undefined) => { const value = normalizeContentType(type); return value === "image/heic" || value === "image/heif"; };

const hasHeicBrand = async (blob: Blob): Promise<boolean> => {
  try {
    const head = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
    const text = String.fromCharCode(...head);
    return text.slice(4, 8) === "ftyp" && heicBrands.has(text.slice(8, 12));
  } catch { return false; }
};
const asJpeg = (blob: Blob) => blob.type === "image/jpeg" ? blob : blob.slice(0, blob.size, "image/jpeg");

/** Converts HEIC/HEIF to JPEG and shrinks what is over 10 MiB; anything else that already fits is returned as is (without touching the codec). */
export const normalizePhoto = async (blob: Blob, hintFormat: string | undefined, codec: ImageCodec): AsyncResult<Blob, PhotoReadError> => {
  if (blob.size > MAX_INPUT_BYTES) return err(new PhotoReadError("size"));
  const declared = unusable(blob.type) ? hintFormat : blob.type;
  const heic = isHeicType(declared) || (unusable(blob.type) && await hasHeicBrand(blob));
  const type = normalizeContentType(declared);
  if (!heic && (blob.size <= MAX_PHOTO_BYTES || type === undefined || !reducible.has(type))) return ok(blob);
  let image: DecodedImage | undefined;
  try {
    image = await codec.decode(blob);
    const attempts = heic ? [HEIC_ATTEMPT, ...LADDER] : LADDER;
    for (const attempt of attempts) {
      const encoded = await codec.encode(image, attempt);
      if (!encoded || encoded.size === 0) return err(new PhotoReadError("convert"));
      if (encoded.size <= MAX_PHOTO_BYTES) return ok(asJpeg(encoded));
    }
    return err(new PhotoReadError("size"));
  } catch {
    return err(new PhotoReadError("convert"));
  } finally {
    try { image?.close(); } catch { /* releasing is best effort */ }
  }
};
