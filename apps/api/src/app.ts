import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";

import {
  type AsyncResult,
  type AuthenticatedUserProfile,
  type AvatarUpload,
  type AuthenticatedSession,
  type ObjectId,
  type RegisterUserPayload,
  type UserProfile,
  type LoginUserPayload,
  type RefreshSessionPayload,
  type RevokeSessionPayload,
  type JoinTripByCodePayload,
  type JoinTripByCodeResult,
  type JoinPublicTripPayload,
  type ListPublicTripsPayload,
  type ResolveTripInvitationPayload,
  type CreateTripPayload,
  type GetTripPayload,
  type ListUserTripsPayload,
  type UpdateTripConfigurationPayload,
  type TripView,
  type TripDetail,
  type TripItinerary,
  type GetTripItineraryPayload,
  type PublicTripPreview,
  type TripMemberSummary,
  type ListTripMembersPayload,
  type ExpelTripParticipantPayload,
  type CreateJourneyDestinationPayload,
  type UpdateJourneyDestinationPayload,
  type DeleteJourneyDestinationPayload,
  type DeleteTripPayload,
  type CreateJourneyTransportPayload,
  type UpdateJourneyTransportPayload,
  type JourneyTransportFields,
  type TripDestination,
  type Transport,
  type Activity,
  type CreateTripActivityPayload,
  type UpdateTripActivityPayload,
  type TripActivityPayload,
  type ActivityDetailPayload,
  type ActivityEditableFields,
  type Result,
  createObjectId,
  ValidationError,
  err,
  ok,
} from "app-domain";
import { emailVerificationBridgePage, emailVerificationErrorPage } from "./auth/email-verification-page.js";
import { tripInvitationBridgePage, tripInvitationErrorPage } from "./trips/trip-invitation-page.js";

export interface HealthResponse {
  app: "travellier";
  status: "ready";
}

export interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface ApiRequest {
  method?: string;
  url?: string;
  body?: unknown;
  authenticatedUserId?: ObjectId;
}

export interface AuthenticationApi {
  verifyEmailToken: (payload: { token: string }) => AsyncResult<void>;
  register: (
    payload: RegisterUserPayload,
  ) => AsyncResult<UserProfile>;
  login: (payload: LoginUserPayload) => AsyncResult<AuthenticatedSession>;
  refresh: (
    payload: RefreshSessionPayload,
  ) => AsyncResult<AuthenticatedSession>;
  logout: (payload: RevokeSessionPayload) => AsyncResult<void>;
  getProfile: (payload: { authenticatedUserId: ObjectId }) => AsyncResult<AuthenticatedUserProfile>;
  updateProfile: (payload: {
    authenticatedUserId: ObjectId;
    name?: string;
    avatar?: string | null;
  }) => AsyncResult<AuthenticatedUserProfile>;
  createAvatarUpload: (payload: { authenticatedUserId: ObjectId; contentType: string }) => AsyncResult<AvatarUpload>;
  getAvatarUrl: (payload: { authenticatedUserId: ObjectId }) => AsyncResult<{ url: string | null }>;
}

export interface ApiDependencies {
  auth?: AuthenticationApi;
  trips?: TripApi;
}

export interface TripInvitationApi {
  joinByCode: (payload: JoinTripByCodePayload) => AsyncResult<JoinTripByCodeResult>;
  resolveInvitation?: (payload: ResolveTripInvitationPayload) => AsyncResult<void>;
}

export interface TripApi extends TripInvitationApi {
  createActivity?: (payload: CreateTripActivityPayload) => AsyncResult<Activity>;
  listActivities?: (payload: TripActivityPayload) => AsyncResult<Activity[]>;
  getActivity?: (payload: ActivityDetailPayload) => AsyncResult<Activity>;
  updateActivity?: (payload: UpdateTripActivityPayload) => AsyncResult<Activity>;
  deleteActivity?: (payload: ActivityDetailPayload) => AsyncResult<void>;
  create?: (payload: CreateTripPayload) => AsyncResult<TripView>;
  get?: (payload: GetTripPayload) => AsyncResult<TripDetail>;
  delete?: (payload: DeleteTripPayload) => AsyncResult<void>;
  getItinerary?: (payload: GetTripItineraryPayload) => AsyncResult<TripItinerary>;
  list?: (payload: ListUserTripsPayload) => AsyncResult<TripView[]>;
  listPublic?: (payload: ListPublicTripsPayload) => AsyncResult<PublicTripPreview[]>;
  joinPublic?: (payload: JoinPublicTripPayload) => AsyncResult<JoinTripByCodeResult>;
  updateConfiguration?: (payload: UpdateTripConfigurationPayload) => AsyncResult<TripView>;
  listMembers?: (payload: ListTripMembersPayload) => AsyncResult<TripMemberSummary[]>;
  expelMember?: (payload: ExpelTripParticipantPayload) => AsyncResult<void>;
  createDestination?: (payload: CreateJourneyDestinationPayload) => AsyncResult<TripDestination>;
  listDestinations?: (payload: { authenticatedUserId: ObjectId; tripId: ObjectId }) => AsyncResult<TripDestination[]>;
  updateDestination?: (payload: UpdateJourneyDestinationPayload) => AsyncResult<TripDestination>;
  deleteDestination?: (payload: DeleteJourneyDestinationPayload) => AsyncResult<void>;
  createTransport?: (payload: CreateJourneyTransportPayload) => AsyncResult<Transport>;
  listTransports?: (payload: { authenticatedUserId: ObjectId; tripId: ObjectId; destinationId: ObjectId }) => AsyncResult<Transport[]>;
  updateTransport?: (payload: UpdateJourneyTransportPayload) => AsyncResult<Transport>;
}

export type RequestAuthenticator = (
  authorization: string | undefined,
) => Promise<{ authenticatedUserId: ObjectId } | undefined>;

export type ApiLogEntry = {
  event: "request" | "response" | "error";
  requestId: string;
  method: string;
  path: string;
  status?: number;
  durationMs?: number;
  errorCode?: string;
  errorName?: string;
  stack?: string[];
};

export type ApiLogger = (entry: ApiLogEntry) => void;

export const createHealthResponse = async (): Promise<HealthResponse> => ({
  app: "travellier",
  status: "ready",
});

const jsonResponse = (statusCode: number, payload: unknown): ApiResponse => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});

const invalidRequestResponse = (): ApiResponse =>
  jsonResponse(400, {
    error: {
      code: "InvalidRequest",
      message: "The request body must be valid JSON.",
    },
  });

const errorResponse = (error: { tag: string }): ApiResponse => {
  if (error instanceof ValidationError) {
    return jsonResponse(422, {
      error: {
        code: error.tag,
        message: error.message,
        fields: error.issues,
      },
    });
  }

  if (error.tag === "EmailAlreadyRegisteredError") {
    return jsonResponse(422, {
      error: {
        code: "RegistrationFailed",
        message: "Unable to register with the provided details.",
      },
    });
  }

  if (
    error.tag === "InvalidCredentialsError" ||
    error.tag === "InvalidSessionError" ||
    error.tag === "SessionExpiredError"
  ) {
    return jsonResponse(401, {
      error: {
        code: error.tag,
        message: "Authentication failed.",
      },
    });
  }

  if (error.tag === "UserNotFoundError") {
    return jsonResponse(404, {
      error: {
        code: error.tag,
        message: "Profile not found.",
      },
    });
  }

  if (error.tag === "InvalidInviteCodeError") {
    return jsonResponse(404, {
      error: { code: "InvalidInviteCodeError", message: "Invitation code not found." },
    });
  }

  if (error.tag === "TripNotFoundError") {
    return jsonResponse(404, {
      error: { code: "TripNotFoundError", message: "Trip not found." },
    });
  }

  if (error.tag === "TripMemberNotFoundError") {
    return jsonResponse(404, {
      error: { code: "TripMemberNotFoundError", message: "Trip member not found." },
    });
  }

  if (error.tag === "ActivityNotFoundError") {
    return jsonResponse(404, { error: { code: error.tag, message: "Activity not found." } });
  }
  if (error.tag === "DestinationNotFoundError" || error.tag === "TransportNotFoundError") {
    return jsonResponse(404, { error: { code: error.tag, message: "Journey resource not found." } });
  }
  if (error.tag === "JourneyConflictError") {
    return jsonResponse(409, { error: { code: error.tag, message: "Journey resource already exists." } });
  }
  if (error.tag === "LastDestinationError" || error.tag === "DeletionConflictError") {
    return jsonResponse(409, { error: { code: error.tag, message: error.tag === "LastDestinationError"
      ? "A Trip must have at least one destination." : "Resources with associated records cannot be deleted." } });
  }
  if (error.tag === "ItineraryConflictError") {
    return jsonResponse(409, { error: { code: error.tag, message: "Transport changes would invalidate activities or remove days with linked data." } });
  }

  if (error.tag === "UnauthorizedError") {
    return jsonResponse(403, {
      error: { code: "Forbidden", message: "This action is not allowed." },
    });
  }

  return jsonResponse(500, {
    error: {
      code: "InternalError",
      message: "Unable to process the request.",
    },
  });
};

const parsePayload = (body: unknown): Record<string, unknown> | undefined => {
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }

  if (typeof body !== "string") {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(body);

    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

const isString = (value: unknown): value is string => typeof value === "string";

const registerPayload = (
  payload: Record<string, unknown>,
): RegisterUserPayload | undefined =>
  isString(payload.email) && isString(payload.name) && isString(payload.password)
    ? { email: payload.email, name: payload.name, password: payload.password }
    : undefined;

const loginPayload = (
  payload: Record<string, unknown>,
): LoginUserPayload | undefined =>
  isString(payload.email) && isString(payload.password)
    ? { email: payload.email, password: payload.password }
    : undefined;

const refreshTokenPayload = (
  payload: Record<string, unknown>,
): RefreshSessionPayload | undefined =>
  isString(payload.refreshToken) ? { refreshToken: payload.refreshToken } : undefined;

const createTripPayload = (payload: Record<string, unknown>): Omit<CreateTripPayload, "authenticatedUserId"> | undefined => {
  if (!isString(payload.name) || !isString(payload.primaryDestination) ||
    (Object.hasOwn(payload, "description") && !isString(payload.description) && payload.description !== null)) {
    return undefined;
  }
  return {
    name: payload.name,
    primaryDestination: payload.primaryDestination,
    ...(Object.hasOwn(payload, "description") ? { description: payload.description as string | null } : {}),
  };
};

const configurationPayload = (payload: Record<string, unknown>): Omit<UpdateTripConfigurationPayload, "authenticatedUserId" | "tripId"> | undefined => {
  const hasVisibility = Object.hasOwn(payload, "visibility");
  const hasVoting = Object.hasOwn(payload, "votingEnabled");
  const hasExpense = Object.hasOwn(payload, "expenseMode");
  if ((!hasVisibility && !hasVoting && !hasExpense) ||
    (hasVisibility && !isString(payload.visibility)) ||
    (hasVoting && typeof payload.votingEnabled !== "boolean") ||
    (hasExpense && !isString(payload.expenseMode))) return undefined;
  return {
    ...(hasVisibility ? { visibility: payload.visibility as UpdateTripConfigurationPayload["visibility"] } : {}),
    ...(hasVoting ? { votingEnabled: payload.votingEnabled as boolean } : {}),
    ...(hasExpense ? { expenseMode: payload.expenseMode as UpdateTripConfigurationPayload["expenseMode"] } : {}),
  };
};

const destinationUpdatePayload = (payload: Record<string, unknown>): Pick<UpdateJourneyDestinationPayload, "name" | "order"> | undefined => {
  const hasName = Object.hasOwn(payload, "name");
  const hasOrder = Object.hasOwn(payload, "order");
  if ((!hasName && !hasOrder) || (hasName && !isString(payload.name)) || (hasOrder && typeof payload.order !== "number")) return undefined;
  return { ...(hasName ? { name: payload.name as string } : {}), ...(hasOrder ? { order: payload.order as number } : {}) };
};

// HTTP dates are strings; MongoDB/domain steps use Date. Never infer dates for legacy clocks.
const transportDetails = (details: Record<string, unknown>): JourneyTransportFields["details"] => ({
  ...details,
  ...(Array.isArray(details.steps) ? { steps: details.steps.map((step: unknown) => {
    if (typeof step !== "object" || step === null || Array.isArray(step) || !("estimatedAt" in step)) return step;
    const value = step.estimatedAt;
    const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
      ? new Date(value) : new Date(Number.NaN);
    // Reject normalized dates such as February 30 rather than silently changing the instant.
    return { ...step, estimatedAt: Number.isFinite(date.getTime()) && date.toISOString() === value ? date : new Date(Number.NaN) };
  }) } : {}),
}) as JourneyTransportFields["details"];

const transportInstant = (value: string): Date => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.exec(value);
  if (!match) return new Date(Number.NaN);
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  // Validate the submitted calendar date before Date normalizes it or applies its offset.
  if (day < 1 || day > daysInMonth) return new Date(Number.NaN);
  return new Date(value);
};

const transportPayload = (payload: Record<string, unknown>): JourneyTransportFields | undefined => {
  if (!isString(payload.direction) || !isString(payload.type) || !isString(payload.departurePlace) ||
    !isString(payload.departureAt) || !isString(payload.arrivalPlace) || !isString(payload.arrivalAt) ||
    !(payload.costPerPerson === null || typeof payload.costPerPerson === "number") ||
    typeof payload.details !== "object" || payload.details === null || Array.isArray(payload.details)) return undefined;
  return {
    direction: payload.direction as JourneyTransportFields["direction"],
    type: payload.type as JourneyTransportFields["type"],
    departurePlace: payload.departurePlace,
    departureAt: transportInstant(payload.departureAt),
    arrivalPlace: payload.arrivalPlace,
    arrivalAt: transportInstant(payload.arrivalAt),
    costPerPerson: payload.costPerPerson,
    details: transportDetails(payload.details as Record<string, unknown>),
  };
};

const transportUpdatePayload = (
  payload: Record<string, unknown>,
): Omit<UpdateJourneyTransportPayload, "authenticatedUserId" | "tripId" | "destinationId" | "transportId"> | undefined => {
  const fields = ["direction", "type", "departurePlace", "departureAt", "arrivalPlace", "arrivalAt", "costPerPerson", "details"] as const;
  const has = (field: typeof fields[number]) => Object.hasOwn(payload, field);
  if (!fields.some(has) ||
    (["direction", "type", "departurePlace", "departureAt", "arrivalPlace", "arrivalAt"] as const)
      .some((field) => has(field) && !isString(payload[field])) ||
    (has("costPerPerson") && !(payload.costPerPerson === null || typeof payload.costPerPerson === "number")) ||
    (has("details") && (typeof payload.details !== "object" || payload.details === null || Array.isArray(payload.details)))) return undefined;
  return {
    ...(has("direction") ? { direction: payload.direction as JourneyTransportFields["direction"] } : {}),
    ...(has("type") ? { type: payload.type as JourneyTransportFields["type"] } : {}),
    ...(has("departurePlace") ? { departurePlace: payload.departurePlace as string } : {}),
    ...(has("departureAt") ? { departureAt: transportInstant(payload.departureAt as string) } : {}),
    ...(has("arrivalPlace") ? { arrivalPlace: payload.arrivalPlace as string } : {}),
    ...(has("arrivalAt") ? { arrivalAt: transportInstant(payload.arrivalAt as string) } : {}),
    ...(has("costPerPerson") ? { costPerPerson: payload.costPerPerson as number | null } : {}),
    ...(has("details") ? { details: transportDetails(payload.details as Record<string, unknown>) } : {}),
  };
};

const profileUpdatePayload = (
  payload: Record<string, unknown>,
): { name?: string; avatar?: string | null } | undefined => {
  const hasName = Object.hasOwn(payload, "name");
  const hasAvatar = Object.hasOwn(payload, "avatar");

  if (
    (!hasName && !hasAvatar) ||
    (hasName && !isString(payload.name)) ||
    (hasAvatar && !isString(payload.avatar) && payload.avatar !== null)
  ) {
    return undefined;
  }

  return {
    ...(hasName ? { name: payload.name as string } : {}),
    ...(hasAvatar ? { avatar: payload.avatar as string | null } : {}),
  };
};

const activityPayload = (payload: Record<string, unknown>, creating: boolean): Result<Partial<ActivityEditableFields>, ValidationError> => {
  const invalid = (field: string, code = "invalid") => err(new ValidationError([
    { field, code, message: `Activity ${field} is ${code === "required" ? "required" : "invalid"}.` },
  ]));
  if (creating) {
    for (const field of ["title", "dayId", "scheduledAt"] as const) {
      if (!Object.hasOwn(payload, field) || payload[field] == null) return invalid(field, "required");
    }
  }
  const fields: Partial<ActivityEditableFields> = {};
  if (Object.hasOwn(payload, "title")) {
    if (!isString(payload.title)) return invalid("title");
    fields.title = payload.title;
  }
  if (Object.hasOwn(payload, "dayId")) {
    const dayId = createObjectId(isString(payload.dayId) ? payload.dayId : "");
    if (!dayId.ok) return invalid("dayId");
    fields.dayId = dayId.value;
  }
  if (Object.hasOwn(payload, "scheduledAt")) {
    const value = payload.scheduledAt;
    if (value == null) return invalid("scheduledAt", "required");
    const match = isString(value) ? /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value) : null;
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3] ?? 0) > 59) return invalid("scheduledAt");
    const date = transportInstant(value as string);
    if (!Number.isFinite(date.getTime())) return invalid("scheduledAt");
    fields.scheduledAt = date;
  }
  for (const field of ["description", "mapsUrl"] as const) {
    if (Object.hasOwn(payload, field)) {
      if (!isString(payload[field]) && payload[field] !== null) return invalid(field);
      fields[field] = payload[field] as string | null;
    }
  }
  return ok(fields);
};

const unavailableResponse = (): ApiResponse =>
  jsonResponse(503, {
    error: {
      code: "ServiceUnavailable",
      message: "API service is not configured.",
    },
  });

export const handleApiRequest = async (
  request: ApiRequest,
  dependencies: ApiDependencies = {},
): Promise<ApiResponse> => {
  if (request.method === "GET" && request.url === "/health") {
    return jsonResponse(200, await createHealthResponse());
  }

  const payload = parsePayload(request.body);
  const auth = dependencies.auth;

  if (request.method === "POST" && request.url === "/trips/join") {
    if (request.authenticatedUserId === undefined) return jsonResponse(401, { error: "Unauthorized" });
    if (payload === undefined || !isString(payload.code)) return invalidRequestResponse();
    if (dependencies.trips === undefined) return unavailableResponse();
    const result = await dependencies.trips.joinByCode({
      authenticatedUserId: request.authenticatedUserId,
      code: payload.code,
    });
    return result.ok ? jsonResponse(200, result.value) : errorResponse(result.error);
  }

  if (request.method === "POST" && request.url === "/trips") {
    if (request.authenticatedUserId === undefined) return jsonResponse(401, { error: "Unauthorized" });
    const input = payload === undefined ? undefined : createTripPayload(payload);
    if (input === undefined) return invalidRequestResponse();
    if (dependencies.trips?.create === undefined) return unavailableResponse();
    const result = await dependencies.trips.create({ authenticatedUserId: request.authenticatedUserId, ...input });
    return result.ok ? jsonResponse(201, { trip: result.value }) : errorResponse(result.error);
  }

  if (request.method === "GET" && request.url === "/trips") {
    if (request.authenticatedUserId === undefined) return jsonResponse(401, { error: "Unauthorized" });
    if (dependencies.trips?.list === undefined) return unavailableResponse();
    const result = await dependencies.trips.list({ authenticatedUserId: request.authenticatedUserId });
    return result.ok ? jsonResponse(200, { trips: result.value }) : errorResponse(result.error);
  }

  if (request.method === "GET" && request.url === "/trips/public") {
    if (request.authenticatedUserId === undefined) return jsonResponse(401, { error: "Unauthorized" });
    if (dependencies.trips?.listPublic === undefined) return unavailableResponse();
    const result = await dependencies.trips.listPublic({ authenticatedUserId: request.authenticatedUserId });
    return result.ok ? jsonResponse(200, { trips: result.value }) : errorResponse(result.error);
  }

  const publicJoinMatch = request.url?.match(/^\/trips\/([^/?]+)\/join$/);
  if (request.method === "POST" && publicJoinMatch) {
    if (request.authenticatedUserId === undefined) return jsonResponse(401, { error: "Unauthorized" });
    const tripId = createObjectId(publicJoinMatch[1] ?? "");
    if (!tripId.ok) return invalidRequestResponse();
    if (dependencies.trips?.joinPublic === undefined) return unavailableResponse();
    const result = await dependencies.trips.joinPublic({ authenticatedUserId: request.authenticatedUserId, tripId: tripId.value });
    return result.ok ? jsonResponse(200, result.value) : errorResponse(result.error);
  }

  const itineraryMatch = request.url?.match(/^\/trips\/([^/?]+)\/itinerary$/);
  if (request.method === "GET" && itineraryMatch) {
    if (request.authenticatedUserId === undefined) return jsonResponse(401, { error: "Unauthorized" });
    const tripId = createObjectId(itineraryMatch[1] ?? "");
    if (!tripId.ok) return invalidRequestResponse();
    if (dependencies.trips?.getItinerary === undefined) return unavailableResponse();
    const result = await dependencies.trips.getItinerary({ authenticatedUserId: request.authenticatedUserId, tripId: tripId.value });
    return result.ok ? jsonResponse(200, { itinerary: result.value }) : errorResponse(result.error);
  }

  const activityListMatch = request.url?.match(/^\/trips\/([^/?]+)\/activities$/);
  const activityDetailMatch = request.url?.match(/^\/trips\/([^/?]+)\/activities\/([^/?]+)$/);
  if (activityListMatch || activityDetailMatch) {
    if (request.authenticatedUserId === undefined) return jsonResponse(401, { error: "Unauthorized" });
    const tripId = createObjectId((activityListMatch ?? activityDetailMatch)?.[1] ?? "");
    if (!tripId.ok) return invalidRequestResponse();
    const activityId = activityDetailMatch ? createObjectId(activityDetailMatch[2] ?? "") : undefined;
    if (activityId !== undefined && !activityId.ok) return invalidRequestResponse();
    const context = { tripId: tripId.value, authenticatedUserId: request.authenticatedUserId };
    const trips = dependencies.trips;
    if (activityListMatch && request.method === "GET") {
      if (!trips?.listActivities) return unavailableResponse();
      const result = await trips.listActivities(context);
      return result.ok ? jsonResponse(200, { activities: result.value }) : errorResponse(result.error);
    }
    if (activityListMatch && request.method === "POST") {
      if (!payload) return invalidRequestResponse();
      const parsed = activityPayload(payload, true);
      if (!parsed.ok) return errorResponse(parsed.error);
      if (!trips?.createActivity) return unavailableResponse();
      const result = await trips.createActivity({ ...context, ...parsed.value } as CreateTripActivityPayload);
      return result.ok ? jsonResponse(201, { activity: result.value }) : errorResponse(result.error);
    }
    if (activityId?.ok) {
      const detail = { ...context, activityId: activityId.value };
      if (request.method === "GET") {
        if (!trips?.getActivity) return unavailableResponse();
        const result = await trips.getActivity(detail);
        return result.ok ? jsonResponse(200, { activity: result.value }) : errorResponse(result.error);
      }
      if (request.method === "PATCH") {
        if (!payload) return invalidRequestResponse();
        const parsed = activityPayload(payload, false);
        if (!parsed.ok) return errorResponse(parsed.error);
        if (Object.keys(parsed.value).length === 0) return invalidRequestResponse();
        if (!trips?.updateActivity) return unavailableResponse();
        const result = await trips.updateActivity({ ...detail, ...parsed.value });
        return result.ok ? jsonResponse(200, { activity: result.value }) : errorResponse(result.error);
      }
      if (request.method === "DELETE") {
        if (!trips?.deleteActivity) return unavailableResponse();
        const result = await trips.deleteActivity(detail);
        return result.ok ? { statusCode: 204, headers: {}, body: "" } : errorResponse(result.error);
      }
    }
  }

  const destinationListMatch = request.url?.match(/^\/trips\/([^/?]+)\/destinations$/);
  const destinationDetailMatch = request.url?.match(/^\/trips\/([^/?]+)\/destinations\/([^/?]+)$/);
  const transportListMatch = request.url?.match(/^\/trips\/([^/?]+)\/destinations\/([^/?]+)\/transports$/);
  const transportDetailMatch = request.url?.match(/^\/trips\/([^/?]+)\/destinations\/([^/?]+)\/transports\/([^/?]+)$/);
  if (destinationListMatch || destinationDetailMatch || transportListMatch || transportDetailMatch) {
    if (request.authenticatedUserId === undefined) return jsonResponse(401, { error: "Unauthorized" });
    const tripId = createObjectId((destinationListMatch ?? destinationDetailMatch ?? transportListMatch ?? transportDetailMatch)?.[1] ?? "");
    if (!tripId.ok) return invalidRequestResponse();
    const destinationId = destinationDetailMatch || transportListMatch || transportDetailMatch
      ? createObjectId((destinationDetailMatch ?? transportListMatch ?? transportDetailMatch)?.[2] ?? "") : undefined;
    if (destinationId !== undefined && !destinationId.ok) return invalidRequestResponse();
    const actor = request.authenticatedUserId;
    if (destinationListMatch && request.method === "GET") {
      if (dependencies.trips?.listDestinations === undefined) return unavailableResponse();
      const result = await dependencies.trips.listDestinations({ authenticatedUserId: actor, tripId: tripId.value });
      return result.ok ? jsonResponse(200, { destinations: result.value }) : errorResponse(result.error);
    }
    if (destinationListMatch && request.method === "POST") {
      if (payload === undefined || !isString(payload.name)) return invalidRequestResponse();
      if (dependencies.trips?.createDestination === undefined) return unavailableResponse();
      const result = await dependencies.trips.createDestination({ authenticatedUserId: actor, tripId: tripId.value, name: payload.name });
      return result.ok ? jsonResponse(201, { destination: result.value }) : errorResponse(result.error);
    }
    if (destinationDetailMatch && request.method === "PATCH" && destinationId?.ok) {
      const update = payload === undefined ? undefined : destinationUpdatePayload(payload);
      if (update === undefined) return invalidRequestResponse();
      if (dependencies.trips?.updateDestination === undefined) return unavailableResponse();
      const result = await dependencies.trips.updateDestination({ authenticatedUserId: actor, tripId: tripId.value, destinationId: destinationId.value, ...update });
      return result.ok ? jsonResponse(200, { destination: result.value }) : errorResponse(result.error);
    }
    if (destinationDetailMatch && request.method === "DELETE" && destinationId?.ok) {
      if (dependencies.trips?.deleteDestination === undefined) return unavailableResponse();
      const result = await dependencies.trips.deleteDestination({ authenticatedUserId: actor, tripId: tripId.value, destinationId: destinationId.value });
      return result.ok ? { statusCode: 204, headers: {}, body: "" } : errorResponse(result.error);
    }
    if (transportListMatch && destinationId?.ok) {
      if (request.method === "GET") {
        if (dependencies.trips?.listTransports === undefined) return unavailableResponse();
        const result = await dependencies.trips.listTransports({ authenticatedUserId: actor, tripId: tripId.value, destinationId: destinationId.value });
        return result.ok ? jsonResponse(200, { transports: result.value }) : errorResponse(result.error);
      }
      if (request.method === "POST") {
        const input = payload === undefined ? undefined : transportPayload(payload);
        if (input === undefined) return invalidRequestResponse();
        if (dependencies.trips?.createTransport === undefined) return unavailableResponse();
        const result = await dependencies.trips.createTransport({ authenticatedUserId: actor, tripId: tripId.value, destinationId: destinationId.value, ...input });
        return result.ok ? jsonResponse(201, { transport: result.value }) : errorResponse(result.error);
      }
    }
    if (transportDetailMatch && request.method === "PATCH" && destinationId?.ok) {
      const transportId = createObjectId(transportDetailMatch[3] ?? "");
      if (!transportId.ok) return invalidRequestResponse();
      const input = payload === undefined ? undefined : transportUpdatePayload(payload);
      if (input === undefined) return invalidRequestResponse();
      if (dependencies.trips?.updateTransport === undefined) return unavailableResponse();
      const result = await dependencies.trips.updateTransport({ authenticatedUserId: actor, tripId: tripId.value,
        destinationId: destinationId.value, transportId: transportId.value, ...input });
      return result.ok ? jsonResponse(200, { transport: result.value }) : errorResponse(result.error);
    }
  }

  const membersMatch = request.url?.match(/^\/trips\/([^/?]+)\/members$/);
  const expelMemberMatch = request.url?.match(/^\/trips\/([^/?]+)\/members\/([^/?]+)$/);
  if ((request.method === "GET" && membersMatch) || (request.method === "DELETE" && expelMemberMatch)) {
    if (request.authenticatedUserId === undefined) return jsonResponse(401, { error: "Unauthorized" });
    const tripId = createObjectId((membersMatch ?? expelMemberMatch)?.[1] ?? "");
    if (!tripId.ok) return invalidRequestResponse();
    if (request.method === "GET") {
      if (dependencies.trips?.listMembers === undefined) return unavailableResponse();
      const result = await dependencies.trips.listMembers({
        authenticatedUserId: request.authenticatedUserId,
        tripId: tripId.value,
      });
      return result.ok
        ? jsonResponse(200, { members: result.value, currentUserId: request.authenticatedUserId })
        : errorResponse(result.error);
    }
    const targetUserId = createObjectId(expelMemberMatch?.[2] ?? "");
    if (!targetUserId.ok) return invalidRequestResponse();
    if (dependencies.trips?.expelMember === undefined) return unavailableResponse();
    const result = await dependencies.trips.expelMember({
      tripId: tripId.value,
      actorUserId: request.authenticatedUserId,
      targetUserId: targetUserId.value,
    });
    return result.ok ? { statusCode: 204, headers: {}, body: "" } : errorResponse(result.error);
  }

  const detailMatch = request.url?.match(/^\/trips\/([^/?]+)$/);
  const configMatch = request.url?.match(/^\/trips\/([^/?]+)\/config$/);
  if (((request.method === "GET" || request.method === "DELETE") && detailMatch !== null && detailMatch !== undefined) ||
    (request.method === "PATCH" && configMatch !== null && configMatch !== undefined)) {
    if (request.authenticatedUserId === undefined) return jsonResponse(401, { error: "Unauthorized" });
    const tripId = createObjectId((detailMatch ?? configMatch)?.[1] ?? "");
    if (!tripId.ok) return invalidRequestResponse();
    if (request.method === "GET") {
      if (dependencies.trips?.get === undefined) return unavailableResponse();
      const result = await dependencies.trips.get({ authenticatedUserId: request.authenticatedUserId, tripId: tripId.value });
      return result.ok ? jsonResponse(200, { trip: result.value }) : errorResponse(result.error);
    }
    if (request.method === "DELETE") {
      if (dependencies.trips?.delete === undefined) return unavailableResponse();
      const result = await dependencies.trips.delete({ authenticatedUserId: request.authenticatedUserId, tripId: tripId.value });
      return result.ok ? { statusCode: 204, headers: {}, body: "" } : errorResponse(result.error);
    }
    const input = payload === undefined ? undefined : configurationPayload(payload);
    if (input === undefined) return invalidRequestResponse();
    if (dependencies.trips?.updateConfiguration === undefined) return unavailableResponse();
    const result = await dependencies.trips.updateConfiguration({ authenticatedUserId: request.authenticatedUserId, tripId: tripId.value, ...input });
    return result.ok ? jsonResponse(200, { trip: result.value }) : errorResponse(result.error);
  }

  if (request.method === "GET" && request.url !== undefined) {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname === "/invite" || pathname.startsWith("/invite/")) {
      const encodedCode = pathname.slice("/invite/".length);
      let code: string;
      try {
        code = decodeURIComponent(encodedCode);
      } catch {
        return tripInvitationErrorPage(400);
      }
      if (!/^[A-Za-z0-9-]{1,64}$/.test(code)) return tripInvitationErrorPage(400);
      if (dependencies.trips?.resolveInvitation === undefined) return tripInvitationErrorPage(503);
      const result = await dependencies.trips.resolveInvitation({ code });
      return result.ok
        ? tripInvitationBridgePage(code)
        : tripInvitationErrorPage(result.error.tag === "InvalidInviteCodeError" ? 404 : 500);
    }
    if (pathname === "/auth/verify" || pathname.startsWith("/auth/verify/")) {
      const token = pathname.slice("/auth/verify/".length);
      if (token.length === 0 || token.length > 4_096 || !/^[A-Za-z0-9_.-]+$/.test(token)) {
        return emailVerificationErrorPage();
      }
      if (auth === undefined) {
        return emailVerificationErrorPage(503);
      }

      const result = await auth.verifyEmailToken({ token });
      return result.ok
        ? emailVerificationBridgePage(token)
        : emailVerificationErrorPage(result.error.tag === "InvalidEmailVerificationTokenError" ? 400 : 500);
    }
  }

  if (request.method === "GET" && request.url === "/profile") {
    if (auth === undefined) {
      return unavailableResponse();
    }

    if (request.authenticatedUserId === undefined) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const result = await auth.getProfile({
      authenticatedUserId: request.authenticatedUserId,
    });

    return result.ok
      ? jsonResponse(200, { profile: result.value })
      : errorResponse(result.error);
  }

  if (request.method === "POST" && request.url === "/profile/avatar-upload") {
    if (auth === undefined) return unavailableResponse();
    if (request.authenticatedUserId === undefined) return jsonResponse(401, { error: "Unauthorized" });
    if (payload === undefined || !isString(payload.contentType)) return invalidRequestResponse();
    const result = await auth.createAvatarUpload({
      authenticatedUserId: request.authenticatedUserId,
      contentType: payload.contentType,
    });
    return result.ok ? jsonResponse(200, result.value) : errorResponse(result.error);
  }

  if (request.method === "GET" && request.url === "/profile/avatar-url") {
    if (auth === undefined) return unavailableResponse();
    if (request.authenticatedUserId === undefined) return jsonResponse(401, { error: "Unauthorized" });
    const result = await auth.getAvatarUrl({ authenticatedUserId: request.authenticatedUserId });
    return result.ok ? jsonResponse(200, result.value) : errorResponse(result.error);
  }

  if (request.method === "PATCH" && request.url === "/profile") {
    const input = payload === undefined ? undefined : profileUpdatePayload(payload);

    if (input === undefined) {
      return invalidRequestResponse();
    }

    if (auth === undefined) {
      return unavailableResponse();
    }

    if (request.authenticatedUserId === undefined) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const result = await auth.updateProfile({
      authenticatedUserId: request.authenticatedUserId,
      ...input,
    });

    return result.ok
      ? jsonResponse(200, { profile: result.value })
      : errorResponse(result.error);
  }

  if (
    request.method === "POST" &&
    request.url === "/auth/register"
  ) {
    const input = payload === undefined ? undefined : registerPayload(payload);

    if (input === undefined) {
      return invalidRequestResponse();
    }

    if (auth === undefined) {
      return unavailableResponse();
    }

    const result = await auth.register(input);

    return result.ok
      ? jsonResponse(201, { user: result.value })
      : errorResponse(result.error);
  }

  if (request.method === "POST" && request.url === "/auth/login") {
    const input = payload === undefined ? undefined : loginPayload(payload);

    if (input === undefined) {
      return invalidRequestResponse();
    }

    if (auth === undefined) {
      return unavailableResponse();
    }

    const result = await auth.login(input);

    return result.ok ? jsonResponse(200, result.value) : errorResponse(result.error);
  }

  if (request.method === "POST" && request.url === "/auth/refresh") {
    const input = payload === undefined ? undefined : refreshTokenPayload(payload);

    if (input === undefined) {
      return invalidRequestResponse();
    }

    if (auth === undefined) {
      return unavailableResponse();
    }

    const result = await auth.refresh(input);

    return result.ok ? jsonResponse(200, result.value) : errorResponse(result.error);
  }

  if (request.method === "POST" && request.url === "/auth/logout") {
    const input = payload === undefined ? undefined : refreshTokenPayload(payload);

    if (input === undefined) {
      return invalidRequestResponse();
    }

    if (auth === undefined) {
      return unavailableResponse();
    }

    const result = await auth.logout(input);

    return result.ok
      ? { statusCode: 204, headers: {}, body: "" }
      : errorResponse(result.error);
  }

  return jsonResponse(404, { error: "NotFound" });
};

const readRequestBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
};

export const defaultCorsOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "capacitor://localhost",
  "http://localhost",
  "https://localhost",
] as const;

export const createRequestHandler = (
  dependencies: ApiDependencies = {},
  authenticate?: RequestAuthenticator,
  logger?: ApiLogger,
  allowedOrigins: readonly string[] = defaultCorsOrigins,
) => {
  const applyCors = cors<IncomingMessage>({
    origin: [...allowedOrigins],
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
    preflightContinue: true,
  });

  return async (request: IncomingMessage, response: ServerResponse) => {
    const startedAt = performance.now();
    const metadata = {
      requestId: randomUUID(),
      method: request.method ?? "UNKNOWN",
      path: (request.url ?? "/").split("?")[0]
        .replace(/(\/auth\/verify\/)[^/]+/g, "$1[REDACTED]")
        .replace(/(\/invite\/)[^/]+/g, "$1[REDACTED]"),
    };
    let errorCode: string | undefined;

    logger?.({ event: "request", ...metadata });
    response.once("finish", () => {
      logger?.({
        event: "response",
        ...metadata,
        status: response.statusCode,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        ...(errorCode === undefined ? {} : { errorCode }),
      });
    });

    try {
      await new Promise<void>((resolve, reject) => {
        applyCors(request, response, (error: unknown) => error ? reject(error) : resolve());
      });
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
      const authenticated = await authenticate?.(request.headers.authorization);
      const apiResponse = await handleApiRequest(
        {
          method: request.method,
          url: request.url,
          body: await readRequestBody(request),
          authenticatedUserId: authenticated?.authenticatedUserId,
        },
        dependencies,
      );
      if (apiResponse.statusCode >= 400) {
        try {
          const payload = JSON.parse(apiResponse.body) as { error?: string | { code?: string } };
          errorCode = typeof payload.error === "string" ? payload.error : payload.error?.code;
        } catch {
          // HTML error pages have no JSON error code; their HTTP status is still logged.
        }
      }
      response.writeHead(apiResponse.statusCode, apiResponse.headers);
      response.end(apiResponse.body);
    } catch (error: unknown) {
      errorCode = "InternalServerError";
      logger?.({
        event: "error",
        ...metadata,
        errorName: error instanceof Error ? error.name : "UnknownError",
        ...(error instanceof Error ? { stack: error.stack?.split("\n").filter((line) => /^\s+at /.test(line)) } : {}),
      });
      const apiResponse = jsonResponse(500, {
        error: { code: errorCode, message: "Unable to complete the request." },
      });
      if (response.headersSent) {
        response.destroy();
      } else {
        response.writeHead(apiResponse.statusCode, apiResponse.headers);
        response.end(apiResponse.body);
      }
    }
  };
};

export const requestHandler = createRequestHandler();

export const createApp = (
  dependencies: ApiDependencies = {},
  authenticate?: RequestAuthenticator,
  logger?: ApiLogger,
  allowedOrigins: readonly string[] = defaultCorsOrigins,
) => createServer(createRequestHandler(dependencies, authenticate, logger, allowedOrigins));

const isEntrypoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, () => {
    console.log(`API listening on http://localhost:${port}`);
  });
}
