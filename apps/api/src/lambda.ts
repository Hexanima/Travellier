import {
  handleApiRequest,
  type ApiResponse,
  type AuthenticationApi,
} from "./app.js";
import {
  readLambdaRuntimeConfig,
  type LambdaRuntimeConfig,
} from "./adapters/aws/runtime-config.js";
import { createSecretsManagerSecretValueReader } from "./adapters/aws/secrets-manager-reader.js";
import { connectMongoDatabase } from "./adapters/mongodb/connection.js";
import { createAuthenticationApi } from "./auth/authentication-api.js";
import { createJwtMiddleware } from "./auth/jwt-middleware.js";

export interface ApiGatewayHttpApiEvent {
  rawPath: string;
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
  handleRequest?: typeof handleApiRequest;
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
    (path.startsWith("/auth/verify/") || path.startsWith("/invite/")));

const isAuthenticationRoute = (path: string, method: string): boolean =>
  method === "POST" &&
  ["/auth/register", "/auth/login", "/auth/refresh", "/auth/logout"].includes(
    path,
  );

const authorizationHeader = (
  headers: ApiGatewayHttpApiEvent["headers"],
): string | undefined => headers?.authorization ?? headers?.Authorization;

const requestBody = (event: ApiGatewayHttpApiEvent): string | undefined => {
  if (event.body === undefined) {
    return undefined;
  }

  return event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
};

export const createLambdaHandler = ({
  loadRuntimeConfig,
  createAuthenticationApi: buildAuthenticationApi,
  handleRequest = handleApiRequest,
}: LambdaHandlerDependencies) =>
  async (
    event: ApiGatewayHttpApiEvent,
  ): Promise<ApiGatewayHttpApiResponse> => {
    const method = event.requestContext.http.method;

    if (isPublicRoute(event.rawPath, method)) {
      let auth: AuthenticationApi | undefined;

      if (isAuthenticationRoute(event.rawPath, method)) {
        const runtimeConfig = await loadRuntimeConfig();
        auth = await buildAuthenticationApi?.(runtimeConfig);
      }

      return handleRequest({
        method,
        url: event.rawPath,
        body: requestBody(event),
      }, auth === undefined ? undefined : { auth });
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

    return handleRequest(
      {
        method,
        url: event.rawPath,
        body: requestBody(event),
        authenticatedUserId: authenticatedRequest.authenticatedUserId,
      },
      auth === undefined ? undefined : { auth },
    );
  };

const secretValueReader = createSecretsManagerSecretValueReader();
let runtimeConfig: LambdaRuntimeConfig | undefined;
let authenticationApi: Promise<AuthenticationApi> | undefined;

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
  authenticationApi ??= connectMongoDatabase(configuration.mongo).then(
    ({ database }) =>
      createAuthenticationApi({ database, jwtSecret: configuration.jwtSecret }),
  );

  return authenticationApi;
};

export const handler = createLambdaHandler({
  loadRuntimeConfig,
  createAuthenticationApi: createRuntimeAuthenticationApi,
});
