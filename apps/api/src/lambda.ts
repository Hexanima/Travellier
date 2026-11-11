import { randomUUID } from "node:crypto";

import {
  apiErrorCode,
  handleApiRequest,
  invalidRequestResponse,
  type ApiLogger,
  type ApiRequest,
  type ApiResponse,
  type AuthenticationApi,
  type PushDeviceApi,
  type TripApi,
} from "./app.js";
import {
  readLambdaRuntimeConfig,
  type LambdaRuntimeConfig,
} from "./adapters/aws/runtime-config.js";
import { createSecretsManagerSecretValueReader } from "./adapters/aws/secrets-manager-reader.js";
import { createS3ObjectStorage } from "./adapters/aws/s3-object-storage.js";
import { connectMongoDatabase } from "./adapters/mongodb/connection.js";
import { createMongoRateLimitRepository } from "./adapters/mongodb/rate-limit-repository.js";
import { createAuthenticationApi } from "./auth/authentication-api.js";
import { createJwtMiddleware } from "./auth/jwt-middleware.js";
import { createPushDeviceApi } from "./push/push-device-api.js";
import { createTripApi } from "./trips/trip-api.js";
import { createAuthRateLimiter, type AuthRateLimiter } from "./security/auth-rate-limit.js";
import { redactPath, sanitizeErrorForLog } from "./security/redact.js";
import { redactingLogger } from "./security/redacting-logger.js";
import { bodyLimitFor, payloadTooLargeResponse, readSecurityConfig, type SecurityConfig } from "./security/request-limits.js";

export interface ApiGatewayHttpApiEvent {
  rawPath: string;
  rawQueryString?: string;
  body?: string;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
  requestContext: {
    http: {
      method: string;
      [attribute: string]: string;
    };
    [attribute: string]: unknown;
  };
  [attribute: string]: unknown;
}

export type ApiGatewayHttpApiResponse = ApiResponse;

export interface LambdaHandlerDependencies {
  loadRuntimeConfig: () => Promise<LambdaRuntimeConfig>;
  createAuthenticationApi?: (
    runtimeConfig: LambdaRuntimeConfig,
  ) => Promise<AuthenticationApi>;
  createTripApi?: (runtimeConfig: LambdaRuntimeConfig) => Promise<TripApi>;
  createPushDeviceApi?: (runtimeConfig: LambdaRuntimeConfig) => Promise<PushDeviceApi>;
  handleRequest?: typeof handleApiRequest;
  /** Auth throttle for `POST /auth/*`; `undefined` means no rate limiting. */
  createRateLimiter?: (runtimeConfig: LambdaRuntimeConfig) => Promise<AuthRateLimiter | undefined>;
  /** Receives request, response and error events (no bodies, headers or query). */
  logger?: ApiLogger;
  security?: SecurityConfig;
}

const unauthorizedResponse = (): ApiGatewayHttpApiResponse => ({
  statusCode: 401,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ error: "Unauthorized" }),
});

const isPublicRoute = (path: string, method: string): boolean =>
  path === "/health" ||
  (method === "POST" &&
    ["/auth/register", "/auth/login", "/auth/refresh", "/auth/logout"].includes(
      path,
    )) ||
  (method === "GET" &&
    (path === "/auth/verify" || path.startsWith("/auth/verify/") || path === "/invite" || path.startsWith("/invite/")));

const isAuthenticationRoute = (path: string, method: string): boolean =>
  (method === "POST" &&
    ["/auth/register", "/auth/login", "/auth/refresh", "/auth/logout"].includes(path)) ||
  (method === "GET" && (path === "/auth/verify" || path.startsWith("/auth/verify/")));

const isInvitationRoute = (path: string, method: string): boolean =>
  method === "GET" && (path === "/invite" || path.startsWith("/invite/"));

const authorizationHeader = (
  headers: ApiGatewayHttpApiEvent["headers"],
): string | undefined => headers?.authorization ?? headers?.Authorization;

const headerValue = (headers: ApiGatewayHttpApiEvent["headers"], name: string): string | undefined =>
  headers?.[name] ?? Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

type BodyOutcome = { body: string | undefined } | { rejected: ApiResponse };

/**
 * Checks the size before decoding or parsing anything: the encoded length alone rejects a huge base64 body without decoding it,
 * and the decoded bytes are measured again. A body that is not valid base64 is a 400.
 */
const readEventBody = (event: ApiGatewayHttpApiEvent, security: SecurityConfig): BodyOutcome => {
  if (event.body === undefined) return { body: undefined };
  const limit = bodyLimitFor(event.rawPath, security);
  if (!event.isBase64Encoded) {
    // A UTF-16 string never has fewer UTF-8 bytes than characters.
    return event.body.length > limit || Buffer.byteLength(event.body, "utf8") > limit
      ? { rejected: payloadTooLargeResponse() }
      : { body: event.body };
  }
  if (event.body.length > Math.ceil(limit / 3) * 4) return { rejected: payloadTooLargeResponse() };
  if (!BASE64.test(event.body)) return { rejected: invalidRequestResponse() };
  const decoded = Buffer.from(event.body, "base64");
  return decoded.length > limit ? { rejected: payloadTooLargeResponse() } : { body: decoded.toString("utf8") };
};

export const createLambdaHandler = ({
  loadRuntimeConfig,
  createAuthenticationApi: buildAuthenticationApi,
  createTripApi: buildTripApi,
  createPushDeviceApi: buildPushDeviceApi,
  createRateLimiter: buildRateLimiter,
  handleRequest = handleApiRequest,
  logger: rawLogger,
  security = readSecurityConfig({}),
}: LambdaHandlerDependencies) => {
  const logger = redactingLogger(rawLogger);
  const route = async (
    event: ApiGatewayHttpApiEvent,
    body: string | undefined,
    transport: Pick<ApiRequest, "clientIp" | "contentType">,
  ): Promise<ApiGatewayHttpApiResponse> => {
    const method = event.requestContext.http.method;

    if (isPublicRoute(event.rawPath, method)) {
      let auth: AuthenticationApi | undefined;
      let trips: TripApi | undefined;
      let rateLimiter: AuthRateLimiter | undefined;

      if (isAuthenticationRoute(event.rawPath, method) || isInvitationRoute(event.rawPath, method)) {
        const runtimeConfig = await loadRuntimeConfig();
        if (isAuthenticationRoute(event.rawPath, method)) {
          auth = await buildAuthenticationApi?.(runtimeConfig);
          if (method === "POST") rateLimiter = await buildRateLimiter?.(runtimeConfig);
        }
        if (isInvitationRoute(event.rawPath, method)) trips = await buildTripApi?.(runtimeConfig);
      }

      return handleRequest({
        method,
        url: event.rawPath,
        body,
        ...transport,
      }, {
        ...(auth === undefined ? {} : { auth }),
        ...(trips === undefined ? {} : { trips }),
        ...(rateLimiter === undefined ? {} : { rateLimiter }),
      });
    }

    const runtimeConfig = await loadRuntimeConfig();
    const authenticate = createJwtMiddleware({
      jwtSecret: runtimeConfig.jwtSecret,
    });
    const authenticatedRequest = await authenticate(
      authorizationHeader(event.headers),
    );

    if (authenticatedRequest === undefined) {
      return unauthorizedResponse();
    }

    const auth = await buildAuthenticationApi?.(runtimeConfig);
    const trips = await buildTripApi?.(runtimeConfig);
    const pushDevices = await buildPushDeviceApi?.(runtimeConfig);

    return handleRequest(
      {
        method,
        // API Gateway splits the query from the path; the routes with parameters (photos, notices) parse it from the url.
        url: event.rawQueryString ? `${event.rawPath}?${event.rawQueryString}` : event.rawPath,
        body,
        authenticatedUserId: authenticatedRequest.authenticatedUserId,
        ...transport,
      },
      {
        ...(auth === undefined ? {} : { auth }),
        ...(trips === undefined ? {} : { trips }),
        ...(pushDevices === undefined ? {} : { pushDevices }),
      },
    );
  };

  return async (event: ApiGatewayHttpApiEvent): Promise<ApiGatewayHttpApiResponse> => {
    const startedAt = performance.now();
    const requestId = typeof event.requestContext.requestId === "string" && event.requestContext.requestId !== ""
      ? event.requestContext.requestId
      : randomUUID();
    const metadata = { requestId, method: event.requestContext.http.method, path: redactPath(event.rawPath) };
    logger?.({ event: "request", ...metadata });

    try {
      // Only the API Gateway source IP is trusted; X-Forwarded-For is client-controlled and is never read.
      const sourceIp = event.requestContext.http.sourceIp;
      const contentType = headerValue(event.headers, "content-type");
      const read = readEventBody(event, security);
      const response = "rejected" in read
        ? read.rejected
        : await route(event, read.body, {
          ...(sourceIp === undefined ? {} : { clientIp: sourceIp }),
          ...(contentType === undefined ? {} : { contentType }),
        });
      const errorCode = apiErrorCode(response);
      logger?.({
        event: "response",
        ...metadata,
        status: response.statusCode,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        ...(errorCode === undefined ? {} : { errorCode }),
      });
      return { ...response, headers: { ...response.headers, "x-request-id": requestId } };
    } catch (error: unknown) {
      logger?.({ event: "error", ...metadata, ...sanitizeErrorForLog(error) });
      throw error;
    }
  };
};

const secretValueReader = createSecretsManagerSecretValueReader();
let runtimeConfig: LambdaRuntimeConfig | undefined;
let authenticationApi: Promise<AuthenticationApi> | undefined;
let tripApi: Promise<TripApi> | undefined;
let pushDeviceApi: Promise<PushDeviceApi> | undefined;
let rateLimiter: Promise<AuthRateLimiter | undefined> | undefined;
let databaseConnection: ReturnType<typeof connectMongoDatabase> | undefined;

const loadDatabase = (configuration: LambdaRuntimeConfig) =>
  databaseConnection ??= connectMongoDatabase(configuration.mongo);

const loadRuntimeConfig = async (): Promise<LambdaRuntimeConfig> => {
  if (runtimeConfig !== undefined) {
    return runtimeConfig;
  }

  runtimeConfig = await readLambdaRuntimeConfig(process.env, secretValueReader);
  return runtimeConfig;
};

const createRuntimeAuthenticationApi = async (
  configuration: LambdaRuntimeConfig,
): Promise<AuthenticationApi> => {
  authenticationApi ??= loadDatabase(configuration).then(
    ({ database }) =>
      createAuthenticationApi({
        database,
        jwtSecret: configuration.jwtSecret,
        storage: createS3ObjectStorage({ bucketName: configuration.photoBucketName }),
      }),
  );

  return authenticationApi;
};

const createRuntimeTripApi = async (configuration: LambdaRuntimeConfig): Promise<TripApi> => {
  tripApi ??= loadDatabase(configuration).then(({ database }) => createTripApi(database, {
    storage: createS3ObjectStorage({ bucketName: configuration.photoBucketName }),
  }));
  return tripApi;
};

const createRuntimePushDeviceApi = async (configuration: LambdaRuntimeConfig): Promise<PushDeviceApi> => {
  pushDeviceApi ??= loadDatabase(configuration).then(({ database }) => createPushDeviceApi(database));
  return pushDeviceApi;
};

// Invalid settings throw at cold start without echoing their values. Rate limiting needs the `rateLimits` TTL index (migration 0009),
// so in Lambda it stays off until AUTH_RATE_LIMIT_ENABLED is explicitly "true" (single source: SecurityConfig.rateLimitEnabled).
const security = readSecurityConfig(process.env, { rateLimitEnabled: false });
const logger: ApiLogger | undefined = process.env.API_VERBOSE === "false"
  ? undefined
  : (entry) => console.log(JSON.stringify(entry));

const createRuntimeRateLimiter = async (configuration: LambdaRuntimeConfig): Promise<AuthRateLimiter | undefined> => {
  if (!security.rateLimitEnabled) return undefined;
  rateLimiter ??= loadDatabase(configuration).then(({ database }) => createAuthRateLimiter({
    port: createMongoRateLimitRepository(database),
    secret: configuration.jwtSecret,
    config: security.authRateLimit,
    onError: (errorName) => console.log(JSON.stringify({ event: "rate-limit-error", errorName })),
  }));
  return rateLimiter;
};

export const handler = createLambdaHandler({
  security,
  ...(logger === undefined ? {} : { logger }),
  loadRuntimeConfig,
  createAuthenticationApi: createRuntimeAuthenticationApi,
  createTripApi: createRuntimeTripApi,
  createPushDeviceApi: createRuntimePushDeviceApi,
  createRateLimiter: createRuntimeRateLimiter,
});
