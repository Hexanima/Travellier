import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type AsyncResult,
  type AuthenticatedSession,
  type ObjectId,
  type RegisterUserPayload,
  type UserProfile,
  type LoginUserPayload,
  type RefreshSessionPayload,
  type RevokeSessionPayload,
  ValidationError,
} from "app-domain";

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
  register: (
    payload: RegisterUserPayload,
  ) => AsyncResult<UserProfile>;
  login: (payload: LoginUserPayload) => AsyncResult<AuthenticatedSession>;
  refresh: (
    payload: RefreshSessionPayload,
  ) => AsyncResult<AuthenticatedSession>;
  logout: (payload: RevokeSessionPayload) => AsyncResult<void>;
}

export interface ApiDependencies {
  auth?: AuthenticationApi;
}

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

const unavailableResponse = (): ApiResponse =>
  jsonResponse(503, {
    error: {
      code: "ServiceUnavailable",
      message: "Authentication is not configured.",
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

export const requestHandler = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  const apiResponse = await handleApiRequest({
    method: request.method,
    url: request.url,
    body: await readRequestBody(request),
  });
  response.writeHead(apiResponse.statusCode, apiResponse.headers);
  response.end(apiResponse.body);
};

export const createApp = () => createServer(requestHandler);

const isEntrypoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, () => {
    console.log(`API listening on http://localhost:${port}`);
  });
}
