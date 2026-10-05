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
  createTripActivity,
  listTripActivities,
  getTripActivity,
  updateTripActivity,
  deleteTripActivity,
  getTripActivityParticipation,
  setTripActivityParticipation,
  getTripActivityVote,
  setTripActivityVote,
  createTripPost,
  listTripPosts,
  getTripPost,
  updateTripPost,
} from "app-domain";

import type { TripApi } from "../app.js";
import { createMongoTripManagementRepository } from "../adapters/mongodb/trip-management-repository.js";
import { createMongoTripMemberRepository } from "../adapters/mongodb/trip-member-repository.js";
import { createMongoTripInvitationRepositories } from "../adapters/mongodb/trip-invitation-repositories.js";
import { createMongoTripJourneyRepository } from "../adapters/mongodb/trip-journey-repository.js";
import { createMongoTripItineraryQueryRepository } from "../adapters/mongodb/trip-itinerary-query-repository.js";
import { createMongoTripDeletionRepository } from "../adapters/mongodb/trip-deletion-repository.js";
import { createTripInvitationApi } from "./trip-invitation-api.js";
import { createMongoTripActivityRepository } from "../adapters/mongodb/trip-activity-repository.js";
import { createMongoTripParticipationRepository } from "../adapters/mongodb/trip-participation-repository.js";
import { createMongoTripVoteRepository } from "../adapters/mongodb/trip-vote-repository.js";
import { createMongoTripPostRepository } from "../adapters/mongodb/trip-post-repository.js";

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
  const activityDependencies = { activities: createMongoTripActivityRepository(database), createId, now: () => new Date() };
  const participationDependencies = { participations: createMongoTripParticipationRepository(database), createId, now: () => new Date() };
  const voteDependencies = { votes: createMongoTripVoteRepository(database), createId, now: () => new Date() };
  const postDependencies = { posts: createMongoTripPostRepository(database), createId, now: () => new Date() };
  return {
    ...createTripInvitationApi(database),
    createPost: (payload) => createTripPost.execute(postDependencies, payload),
    listPosts: (payload) => listTripPosts.execute(postDependencies, payload),
    getPost: (payload) => getTripPost.execute(postDependencies, payload),
    updatePost: (payload) => updateTripPost.execute(postDependencies, payload),
    getActivityVote: (payload) => getTripActivityVote.execute(voteDependencies, payload),
    setActivityVote: (payload) => setTripActivityVote.execute(voteDependencies, payload),
    getActivityParticipation: (payload) => getTripActivityParticipation.execute(participationDependencies, payload),
    setActivityParticipation: (payload) => setTripActivityParticipation.execute(participationDependencies, payload),
    createActivity: (payload) => createTripActivity.execute(activityDependencies, payload),
    listActivities: (payload) => listTripActivities.execute(activityDependencies, payload),
    getActivity: (payload) => getTripActivity.execute(activityDependencies, payload),
    updateActivity: (payload) => updateTripActivity.execute(activityDependencies, payload),
    deleteActivity: (payload) => deleteTripActivity.execute(activityDependencies, payload),
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
