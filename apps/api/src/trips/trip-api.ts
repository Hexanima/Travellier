import { randomInt } from "node:crypto";
import { ObjectId as MongoObjectId, type Db } from "mongodb";

import {
  createObjectId,
  createTrip,
  expelTripParticipant,
  getTrip,
  getTripItinerary,
  listTripMembers,
  listPublicTrips,
  listUserTrips,
  joinPublicTrip,
  updateTripConfiguration,
  createJourneyDestination,
  listJourneyDestinations,
  updateJourneyDestination,
  createJourneyTransport,
  listJourneyTransports,
  updateJourneyTransport,
  deleteJourneyDestination,
  deleteTrip,
} from "app-domain";

import type { TripApi } from "../app.js";
import { createMongoTripManagementRepository } from "../adapters/mongodb/trip-management-repository.js";
import { createMongoTripMemberRepository } from "../adapters/mongodb/trip-member-repository.js";
import { createMongoTripInvitationRepositories } from "../adapters/mongodb/trip-invitation-repositories.js";
import { createMongoTripJourneyRepository } from "../adapters/mongodb/trip-journey-repository.js";
import { createMongoTripItineraryQueryRepository } from "../adapters/mongodb/trip-itinerary-query-repository.js";
import { createMongoTripDeletionRepository } from "../adapters/mongodb/trip-deletion-repository.js";
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
  const journeys = createMongoTripJourneyRepository(database);
  const itinerary = createMongoTripItineraryQueryRepository(database);
  const journeyDependencies = { journeys, members, createId };
  const deletion = createMongoTripDeletionRepository(database);
  return {
    ...createTripInvitationApi(database),
    create: (payload) => createTrip.execute({ trips, createId, createInviteCode, now: () => new Date() }, payload),
    get: (payload) => getTrip.execute({ trips }, payload),
    delete: (payload) => deleteTrip.execute({ deletion }, payload),
    getItinerary: (payload) => getTripItinerary.execute({ members, itinerary }, payload),
    list: (payload) => listUserTrips.execute({ trips }, payload),
    listPublic: (payload) => listPublicTrips.execute({ trips }, payload),
    joinPublic: (payload) => joinPublicTrip.execute({ members: publicJoinMembers }, payload),
    updateConfiguration: (payload) => updateTripConfiguration.execute({ trips }, payload),
    listMembers: (payload) => listTripMembers.execute({ members }, payload),
    expelMember: (payload) => expelTripParticipant.execute({ members }, payload),
    createDestination: (payload) => createJourneyDestination.execute({ ...journeyDependencies, createId, now: () => new Date() }, payload),
    listDestinations: (payload) => listJourneyDestinations.execute({ ...journeyDependencies, deletion }, payload),
    updateDestination: (payload) => updateJourneyDestination.execute(journeyDependencies, payload),
    deleteDestination: (payload) => deleteJourneyDestination.execute({ deletion }, payload),
    createTransport: (payload) => createJourneyTransport.execute({ ...journeyDependencies, createId }, payload),
    listTransports: (payload) => listJourneyTransports.execute(journeyDependencies, payload),
    updateTransport: (payload) => updateJourneyTransport.execute(journeyDependencies, payload),
  };
};
