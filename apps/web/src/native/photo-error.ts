import { TaggedError } from "app-domain";
import type { PhotoRejection } from "../trips/photo-limits.js";

export class PhotoReadError extends TaggedError<"PhotoReadError"> {
  readonly reason: PhotoRejection | "read";
  constructor(reason: PhotoRejection | "read") {
    super("PhotoReadError");
    this.reason = reason;
    this.message = `Photo read: ${reason}`;
  }
}
