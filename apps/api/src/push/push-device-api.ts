import type { Db } from "mongodb";
import { registerPushDevice, revokePushDevice, revokePushDeviceByToken } from "app-domain";

import type { PushDeviceApi } from "../app.js";
import { createMongoPushDeviceRepository } from "../adapters/mongodb/push-device-repository.js";

export interface PushDeviceApiOptions {
  now?: () => Date;
}

/** Binds the push device use cases to MongoDB. The user always comes from the authenticated request, never from the body. */
export const createPushDeviceApi = (database: Db, { now = () => new Date() }: PushDeviceApiOptions = {}): PushDeviceApi => {
  const pushDevices = createMongoPushDeviceRepository(database);
  return {
    register: ({ authenticatedUserId, input }) => registerPushDevice.execute({ pushDevices }, { userId: authenticatedUserId, input, now: now() }),
    revoke: ({ authenticatedUserId, deviceId }) => revokePushDevice.execute({ pushDevices }, { userId: authenticatedUserId, deviceId }),
    revokeByToken: ({ authenticatedUserId, input }) => revokePushDeviceByToken.execute({ pushDevices }, { userId: authenticatedUserId, input }),
  };
};
