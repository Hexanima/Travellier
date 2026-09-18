import { handleApiRequest, type ApiResponse } from "./app.js";
import {
  readLambdaRuntimeConfig,
  type LambdaRuntimeConfig,
} from "./adapters/aws/runtime-config.js";
import { createSecretsManagerSecretValueReader } from "./adapters/aws/secrets-manager-reader.js";
import { createJwtMiddleware } from "./auth/jwt-middleware.js";

export interface ApiGatewayHttpApiEvent {
  rawPath: string;
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
    ["/auth/register", "/auth/login", "/auth/refresh"].includes(path)) ||
  (method === "GET" &&
    (path.startsWith("/auth/verify/") || path.startsWith("/invite/")));

const authorizationHeader = (
  headers: ApiGatewayHttpApiEvent["headers"],
): string | undefined => headers?.authorization ?? headers?.Authorization;

export const createLambdaHandler = ({
  loadRuntimeConfig,
  handleRequest = handleApiRequest,
}: LambdaHandlerDependencies) =>
  async (
    event: ApiGatewayHttpApiEvent,
  ): Promise<ApiGatewayHttpApiResponse> => {
    const method = event.requestContext.http.method;

    if (isPublicRoute(event.rawPath, method)) {
      return handleRequest({ method, url: event.rawPath });
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

    return handleRequest({
      method,
      url: event.rawPath,
      authenticatedUserId: authenticatedRequest.authenticatedUserId,
    });
  };

const secretValueReader = createSecretsManagerSecretValueReader();
let runtimeConfig: LambdaRuntimeConfig | undefined;

const loadRuntimeConfig = async (): Promise<LambdaRuntimeConfig> => {
  if (runtimeConfig !== undefined) {
    return runtimeConfig;
  }

  runtimeConfig = await readLambdaRuntimeConfig(process.env, secretValueReader);
  return runtimeConfig;
};

export const handler = createLambdaHandler({ loadRuntimeConfig });
