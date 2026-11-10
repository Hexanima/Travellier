import { TaggedError, err, ok, type AsyncResult, type SelectedPhoto } from "app-domain";
import { validatePhoto, type PhotoRejection } from "../trips/photo-limits.js";

export class PhotoReadError extends TaggedError<"PhotoReadError"> {
  readonly reason: PhotoRejection | "read";
  constructor(reason: PhotoRejection | "read") {
    super("PhotoReadError");
    this.reason = reason;
    this.message = `Photo read: ${reason}`;
  }
}
/** Reads the chosen file as a Blob of the webview (the binary stays out of React state and out of Lambda). */
export type PhotoFileReader = { read: (photo: SelectedPhoto) => AsyncResult<Blob, PhotoReadError> };
export type PhotoFileDependencies = { fetch: (url: string) => Promise<Response>; convertFileSrc: (reference: string) => string };
const unusable = (type: string) => type === "" || type === "application/octet-stream";

export const createPhotoFileReader = ({ fetch, convertFileSrc }: PhotoFileDependencies): PhotoFileReader => ({
  read: async (photo) => {
    let blob: Blob;
    try {
      const response = await fetch(photo.previewUrl ?? convertFileSrc(photo.reference));
      if (!response.ok) return err(new PhotoReadError("read"));
      blob = await response.blob();
    } catch {
      return err(new PhotoReadError("read"));
    }
    const checked = validatePhoto(unusable(blob.type) ? photo.format : blob.type, blob.size);
    if (!checked.ok) return err(new PhotoReadError(checked.reason));
    return ok(blob.type === checked.contentType ? blob : blob.slice(0, blob.size, checked.contentType));
  },
});
