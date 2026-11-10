import type { Db } from "mongodb";
import { err, ok, UnknownError, type PhotoLinkPort } from "app-domain";

/** Reads `postPhotos.s3Key` across every Trip: a key linked anywhere must never be deleted by the cleanup. */
export const createMongoPhotoLinkRepository = (database: Db): PhotoLinkPort => ({
  findLinkedKeys: async (keys) => {
    if (keys.length === 0) return ok(new Set<string>());
    try {
      const photos = await database.collection<{ s3Key: string }>("postPhotos")
        .find({ s3Key: { $in: [...keys] } }, { projection: { s3Key: 1 } }).toArray();
      return ok(new Set(photos.map((photo) => photo.s3Key)));
    } catch { return err(new UnknownError("Photo link lookup failed.")); }
  },
});
