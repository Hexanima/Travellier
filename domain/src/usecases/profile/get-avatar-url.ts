import { UserNotFoundError } from "../../errors/user-not-found-error.js";
import type { UserRepository } from "../../ports/authentication-port.js";
import type { ObjectStoragePort } from "../../ports/object-storage-port.js";
import { err, type AsyncResult } from "../../types/result.js";
import type { ObjectId } from "../../value-objects/object-id.js";

export const getAvatarUrl = {
  execute: async (
    dependencies: { users: UserRepository; storage: ObjectStoragePort },
    payload: { authenticatedUserId: ObjectId },
  ): AsyncResult<{ url: string | null }> => {
    const user = await dependencies.users.findById(payload.authenticatedUserId);
    if (!user.ok) return user;
    if (user.value === undefined) return err(new UserNotFoundError());
    if (user.value.avatarS3Key === null) return { ok: true, value: { url: null } };

    const target = await dependencies.storage.createDownloadTarget({
      objectKey: user.value.avatarS3Key,
      expiresInSeconds: 300,
    });
    return target.ok ? { ok: true, value: { url: target.value.downloadUrl } } : target;
  },
};
