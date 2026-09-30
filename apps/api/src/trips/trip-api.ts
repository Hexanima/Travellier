import { randomInt } from "node:crypto";
import { ObjectId as MongoObjectId, type Db } from "mongodb";

import {
  createObjectId,
  createTrip,
  expelTripParticipant,
  getTrip,
  listTripMembers,
  listPublicTrips,
  listUserTrips,
  joinPublicTrip,
  updateTripConfiguration,
} from "app-domain";

import type { TripApi } from "../app.js";
import { createMongoTripManagementRepository } from "../adapters/mongodb/trip-management-repository.js";
import { createMongoTripMemberRepository } from "../adapters/mongodb/trip-member-repository.js";
import { createMongoTripInvitationRepositories } from "../adapters/mongodb/trip-invitation-repositories.js";
import { createTripInvitationApi } from "./trip-invitation-api.js";

const inviteAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const createInviteCode = (): string => {
  let suffix = "";
  for (let i = 0; i < 8; i += 1) suffix += inviteAlphabet[randomInt(inviteAlphabet.length)];
  return `VIAJE-${suffix}`;
};

const createId = () => {
  const id = createObjectId(new MongoObjectId().toHexString());
  if (!id.ok) throw id.error;
  return id.value;
};

export const createTripApi = (database: Db): TripApi => {
  const trips = createMongoTripManagementRepository(database);
  const members = createMongoTripMemberRepository(database);
  const publicJoinMembers = createMongoTripInvitationRepositories(database).members;
  return {
    ...createTripInvitationApi(database),
    create: (payload) => createTrip.execute({ trips, createId, createInviteCode, now: () => new Date() }, payload),
    get: (payload) => getTrip.execute({ trips }, payload),
    list: (payload) => listUserTrips.execute({ trips }, payload),
    listPublic: (payload) => listPublicTrips.execute({ trips }, payload),
    joinPublic: (payload) => joinPublicTrip.execute({ trips, members: publicJoinMembers }, payload),
    updateConfiguration: (payload) => updateTripConfiguration.execute({ trips }, payload),
    listMembers: (payload) => listTripMembers.execute({ members }, payload),
    expelMember: (payload) => expelTripParticipant.execute({ members }, payload),
  };
};
