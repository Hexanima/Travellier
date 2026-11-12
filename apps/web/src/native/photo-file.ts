import { err, ok, type AsyncResult, type SelectedPhoto } from "app-domain";
import { validatePhoto } from "../trips/photo-limits.js";
import type { ImageCodec } from "./image-codec.js";
import { PhotoReadError } from "./photo-error.js";
import { normalizePhoto } from "./photo-normalize.js";

export { PhotoReadError };
/** Reads the chosen file as a Blob of the webview (the binary stays out of React state and out of Lambda). */
export type PhotoFileReader = { read: (photo: SelectedPhoto) => AsyncResult<Blob, PhotoReadError> };
export type PhotoFileDependencies = { fetch: (url: string) => Promise<Response>; convertFileSrc: (reference: string) => string;
  /** Converts HEIC/HEIF and shrinks heavy photos; without it the file is only validated. */
  codec?: ImageCodec };
const unusable = (type: string) => type === "" || type === "application/octet-stream";

export const createPhotoFileReader = ({ fetch, convertFileSrc, codec }: PhotoFileDependencies): PhotoFileReader => ({
  read: async (photo) => {
    let blob: Blob;
    try {
      const response = await fetch(photo.previewUrl ?? convertFileSrc(photo.reference));
      if (!response.ok) return err(new PhotoReadError("read"));
      blob = await response.blob();
    } catch {
      return err(new PhotoReadError("read"));
    }
    if (codec) {
      const normalized = await normalizePhoto(blob, photo.format, codec);
      if (!normalized.ok) return normalized;
      blob = normalized.value;
    }
    const checked = validatePhoto(unusable(blob.type) ? photo.format : blob.type, blob.size);
    if (!checked.ok) return err(new PhotoReadError(checked.reason));
    return ok(blob.type === checked.contentType ? blob : blob.slice(0, blob.size, checked.contentType));
  },
});
