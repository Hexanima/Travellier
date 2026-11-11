import { randomInt, randomUUID } from "node:crypto";
import { ObjectId as MongoObjectId, type Db } from "mongodb";

import {
  createObjectId,
  createTrip,
  changeTripMemberRole,
  expelTripParticipant,
  leaveTrip,
  transferTripOwnership,
  getTrip,
  getTripItinerary,
  getTripBalance,
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
  createTripPost,
  createTripPhotoUploads,
  getTripPostPhotos,
  getTripPhoto,
  listTripPhotos,
  err,
  UnknownError,
  type ObjectStoragePort,
  listTripPosts,
  getTripPost,
  getTripPostChain,
  updateTripPost,
  linkTripPostToNewActivity,
  createTripPostComment,
  listTripPostComments,
  updateTripPostComment,
  likeTripPost,
  unlikeTripPost,
  likeTripComment,
  unlikeTripComment,
  getTripPostLikes,
  listUserNotifications,
} from "app-domain";

import type { TripApi } from "../app.js";
import { createMongoTripManagementRepository } from "../adapters/mongodb/trip-management-repository.js";
import { createMongoTripMemberRepository } from "../adapters/mongodb/trip-member-repository.js";
import { createMongoTripInvitationRepositories } from "../adapters/mongodb/trip-invitation-repositories.js";
import { createMongoTripJourneyRepository } from "../adapters/mongodb/trip-journey-repository.js";
import { createMongoTripItineraryQueryRepository } from "../adapters/mongodb/trip-itinerary-query-repository.js";
import { createMongoTripBalanceQueryRepository } from "../adapters/mongodb/trip-balance-query-repository.js";
import { createMongoTripDeletionRepository } from "../adapters/mongodb/trip-deletion-repository.js";
import { createMongoTripMemberAdministrationRepository } from "../adapters/mongodb/trip-member-administration-repository.js";
import { createTripInvitationApi } from "./trip-invitation-api.js";
import { createMongoTripActivityRepository } from "../adapters/mongodb/trip-activity-repository.js";
import { createMongoTripParticipationRepository } from "../adapters/mongodb/trip-participation-repository.js";
import { createMongoTripPostRepository } from "../adapters/mongodb/trip-post-repository.js";
import { createMongoTripCommentRepository } from "../adapters/mongodb/trip-comment-repository.js";
import { createMongoTripLikeRepository } from "../adapters/mongodb/trip-like-repository.js";
import { createMongoUserNotificationQueryRepository } from "../adapters/mongodb/user-notification-repository.js";

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

export interface TripApiOptions {
  /** Private photo bucket; without it photo endpoints answer 500 and posts without photos keep working. */
  storage?: ObjectStoragePort;
}

export const createTripApi = (database: Db, { storage }: TripApiOptions = {}): TripApi => {
  const trips = createMongoTripManagementRepository(database);
  const members = createMongoTripMemberRepository(database);
  const publicJoinMembers = createMongoTripInvitationRepositories(database).members;
  const journeys = createMongoTripJourneyRepository(database);
  const itinerary = createMongoTripItineraryQueryRepository(database);
  const balance = createMongoTripBalanceQueryRepository(database);
  const journeyDependencies = { journeys, members, createId };
  const deletion = createMongoTripDeletionRepository(database);
  const memberAdministration = createMongoTripMemberAdministrationRepository(database);
  const activityDependencies = { activities: createMongoTripActivityRepository(database), createId, now: () => new Date() };
  const participationDependencies = { participations: createMongoTripParticipationRepository(database), createId, now: () => new Date() };
  const postDependencies = { posts: createMongoTripPostRepository(database), createId, now: () => new Date(), ...(storage ? { storage } : {}) };
  const missingStorage = () => Promise.resolve(err(new UnknownError("Object storage is not configured.")));
  const photoDependencies = storage ? { posts: postDependencies.posts, storage } : undefined;
  const commentDependencies = { comments: createMongoTripCommentRepository(database), createId, now: () => new Date() };
  const notificationDependencies = { notifications: createMongoUserNotificationQueryRepository(database) };
  const likeDependencies = { likes: createMongoTripLikeRepository(database), createId, now: () => new Date() };
  return {
    ...createTripInvitationApi(database),
    createPost: (payload) => createTripPost.execute(postDependencies, payload),
    listPosts: (payload) => listTripPosts.execute(postDependencies, payload),
    getPost: (payload) => getTripPost.execute(postDependencies, payload),
    getPostChain: (payload) => getTripPostChain.execute(postDependencies, payload),
    updatePost: (payload) => updateTripPost.execute(postDependencies, payload),
    createPhotoUploads: (payload) => photoDependencies
      ? createTripPhotoUploads.execute({ ...photoDependencies, createUploadId: randomUUID }, payload) : missingStorage(),
    getPostPhotos: (payload) => photoDependencies
      ? getTripPostPhotos.execute({ ...photoDependencies, now: () => new Date() }, payload) : missingStorage(),
    getPhoto: (payload) => photoDependencies
      ? getTripPhoto.execute({ ...photoDependencies, now: () => new Date() }, payload) : missingStorage(),
    listPhotos: (payload) => photoDependencies
      ? listTripPhotos.execute({ ...photoDependencies, now: () => new Date() }, payload) : missingStorage(),
    linkPostToNewActivity: (payload) => linkTripPostToNewActivity.execute(postDependencies, payload),
    listComments: (payload) => listTripPostComments.execute(commentDependencies, payload),
    createComment: (payload) => createTripPostComment.execute(commentDependencies, payload),
    updateComment: (payload) => updateTripPostComment.execute(commentDependencies, payload),
    listNotifications: (payload) => listUserNotifications.execute(notificationDependencies, payload),
    likePost: (payload) => likeTripPost.execute(likeDependencies, payload),
    unlikePost: (payload) => unlikeTripPost.execute(likeDependencies, payload),
    likeComment: (payload) => likeTripComment.execute(likeDependencies, payload),
    unlikeComment: (payload) => unlikeTripComment.execute(likeDependencies, payload),
    getPostLikes: (payload) => getTripPostLikes.execute(likeDependencies, payload),
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
    getBalance: (payload) => getTripBalance.execute({ balance }, payload),
    list: (payload) => listUserTrips.execute({ trips }, payload),
    listPublic: (payload) => listPublicTrips.execute({ trips }, payload),
    joinPublic: (payload) => joinPublicTrip.execute({ members: publicJoinMembers, now: () => new Date() }, payload),
    updateConfiguration: (payload) => updateTripConfiguration.execute({ trips }, payload),
    listMembers: (payload) => listTripMembers.execute({ members }, payload),
    expelMember: (payload) => expelTripParticipant.execute({ administration: memberAdministration, now: () => new Date() }, payload),
    leaveTrip: (payload) => leaveTrip.execute({ administration: memberAdministration, now: () => new Date() }, payload),
    changeMemberRole: (payload) => changeTripMemberRole.execute({ administration: memberAdministration }, payload),
    transferOwnership: (payload) => transferTripOwnership.execute({ administration: memberAdministration }, payload),
    createDestination: (payload) => createJourneyDestination.execute({ ...journeyDependencies, createId, now: () => new Date() }, payload),
    listDestinations: (payload) => listJourneyDestinations.execute({ ...journeyDependencies, deletion }, payload),
    updateDestination: (payload) => updateJourneyDestination.execute(journeyDependencies, payload),
    deleteDestination: (payload) => deleteJourneyDestination.execute({ deletion }, payload),
    createTransport: (payload) => createJourneyTransport.execute({ ...journeyDependencies, createId }, payload),
    listTransports: (payload) => listJourneyTransports.execute(journeyDependencies, payload),
    updateTransport: (payload) => updateJourneyTransport.execute(journeyDependencies, payload),
  };
};
