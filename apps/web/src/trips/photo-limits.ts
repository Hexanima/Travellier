/** Limits of T72 (the server enforces them too): jpeg/png/webp, 10 MiB per file, 10 photos per batch and per post. HEIC is not supported. */
export const MAX_PHOTOS = 10;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export type PhotoRejection = "heic" | "type" | "size";
export type PhotoCheck = { ok: true; contentType: string } | { ok: false; reason: PhotoRejection };
const accepted = new Set(["image/jpeg", "image/png", "image/webp"]);
/** Accepts a native `format` («jpg») or a mime type: `jpg` and `image/jpg` become `image/jpeg`. */
export const normalizeContentType = (value: string | undefined): string | undefined => {
  const text = value?.trim().toLowerCase().replace(/^image\//, "");
  if (!text) return undefined;
  return `image/${text === "jpg" ? "jpeg" : text}`;
};
export const validatePhoto = (contentType: string | undefined, sizeBytes: number): PhotoCheck => {
  const normalized = normalizeContentType(contentType);
  if (normalized === "image/heic" || normalized === "image/heif") return { ok: false, reason: "heic" };
  if (normalized === undefined || !accepted.has(normalized)) return { ok: false, reason: "type" };
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_PHOTO_BYTES) return { ok: false, reason: "size" };
  return { ok: true, contentType: normalized };
};
export const photoRejectionMessage = (reason: PhotoRejection): string =>
  reason === "heic" ? "Las fotos HEIC todavía no se pueden subir. Elegí una foto JPEG, PNG o WebP."
    : reason === "size" ? "La foto pesa más de 10 MB o está vacía. Elegí otra."
      : "Solo se aceptan fotos JPEG, PNG o WebP.";
