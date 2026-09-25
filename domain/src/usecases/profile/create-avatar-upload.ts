import { ValidationError } from "../../errors/validation-error.js";
import type { ObjectStoragePort, UploadTarget } from "../../ports/object-storage-port.js";
import { err, type AsyncResult } from "../../types/result.js";
import type { ObjectId } from "../../value-objects/object-id.js";

const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type AvatarUpload = UploadTarget & { avatar: string };

export const createAvatarUpload = {
  execute: async (
    dependencies: { storage: ObjectStoragePort; createId: () => string },
    payload: { authenticatedUserId: ObjectId; contentType: string },
  ): AsyncResult<AvatarUpload> => {
    const extension = extensions[payload.contentType];
    if (extension === undefined) {
      return err(new ValidationError([{
        field: "contentType", code: "unsupported", message: "Unsupported avatar image type.",
      }]));
    }

    const avatar = `avatars/${payload.authenticatedUserId}/${dependencies.createId()}.${extension}`;
    const target = await dependencies.storage.createUploadTarget({
      objectKey: avatar,
      contentType: payload.contentType,
      expiresInSeconds: 300,
    });
    return target.ok ? { ok: true, value: { avatar, ...target.value } } : target;
  },
};
