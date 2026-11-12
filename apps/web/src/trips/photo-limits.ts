/** Limits of T72 (the server enforces them too): jpeg/png/webp, 10 MiB per file, 10 photos per batch and per post. HEIC/HEIF are converted to JPEG on the device (T129) and heavy photos are shrunk, so `validatePhoto` checks the final output. */
export const MAX_PHOTOS = 10;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export type PhotoRejection = "type" | "size" | "convert";
export type PhotoCheck = { ok: true; contentType: string } | { ok: false; reason: PhotoRejection };
const accepted = new Set(["image/jpeg", "image/png", "image/webp"]);
/** Accepts a native `format` («jpg») or a mime type: `jpg` and `image/jpg` become `image/jpeg`. */
export const normalizeContentType = (value: string | undefined): string | undefined => {
  const text = value?.trim().toLowerCase().replace(/^image\//, "");
  if (!text) return undefined;
  return `image/${text === "jpg" ? "jpeg" : text}`;
};
/** Final output check: jpeg/png/webp, not empty and up to 10 MiB. */
export const validatePhoto = (contentType: string | undefined, sizeBytes: number): PhotoCheck => {
  const normalized = normalizeContentType(contentType);
  if (normalized === undefined || !accepted.has(normalized)) return { ok: false, reason: "type" };
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_PHOTO_BYTES) return { ok: false, reason: "size" };
  return { ok: true, contentType: normalized };
};
export const photoRejectionMessage = (reason: PhotoRejection): string =>
  reason === "convert" ? "No pudimos convertir o reducir esta foto. Quitala o elegí otra."
    : reason === "size" ? "La foto pesa más de 10 MB o está vacía. Elegí otra."
      : "Solo se aceptan fotos JPEG, PNG o WebP.";
