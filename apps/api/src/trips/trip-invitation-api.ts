import type { Db } from "mongodb";

import { joinTripByCode } from "app-domain";

import type { TripInvitationApi } from "../app.js";
import { createMongoTripInvitationRepositories } from "../adapters/mongodb/trip-invitation-repositories.js";

export const createTripInvitationApi = (database: Db): TripInvitationApi => {
  const repositories = createMongoTripInvitationRepositories(database);
  return {
    joinByCode: (payload) => joinTripByCode.execute(repositories, payload),
  };
};
