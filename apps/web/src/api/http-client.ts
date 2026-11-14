import { err, ok, type AsyncResult, TaggedError } from "app-domain";

import { timeoutNotice } from "./api-messages.js";

export type ApiErrorKind =
  | "client"
  | "network"
  | "unauthorized"
  | "forbidden"
  | "validation"
  | "not-found"
  | "server";

export type ApiFieldError = {
  field: string;
  code: string;
  message: string;
};

export class ApiClientError extends TaggedError<"ApiClientError"> {
  readonly kind: ApiErrorKind;
  readonly code: string;
  readonly status: number | undefined;
  readonly fields: readonly ApiFieldError[] | undefined;
  /** Only for 409 ParticipationConflictError: the raw `conflicts` and `activity`, unvalidated. */
  details?: Readonly<Record<string, unknown>>;
  /** Only for 409 PostRequestConflictError: `reason` ("already_saved") and `postId` when the server sends them as strings; a generic 409 carries neither. */
  reason?: string;
  postId?: string;

  constructor(
    kind: ApiErrorKind,
    code: string,
    message: string,
    status?: number,
    fields?: readonly ApiFieldError[],
  ) {
    super("ApiClientError");
    this.kind = kind;
    this.code = code;
    this.message = message;
    this.status = status;
    this.fields = fields;
  }
}

type FetchApi = (input: string, init: RequestInit) => Promise<Response>;

export type HttpClientDependencies = {
  baseUrl: string;
  fetch: FetchApi;
  getAccessToken: () => Promise<string | null>;
  /** Receives the bearer the failed request carried (null when none), so a late 401 can be told apart from the active session. */
  onUnauthorized: (requestAccessToken: string | null) => void | Promise<void>;
  /** Aborts a request (including a slow body) once it takes this long; defaults to 30 s. */
  timeoutMs?: number;
};

type RequestOptions = {
  headers?: Record<string, string>;
  body?: unknown;
  authenticated?: boolean;
};

export type HttpClient = {
  get: <TResponse>(path: string, options?: Omit<RequestOptions, "body">) => AsyncResult<TResponse, ApiClientError>;
  post: <TResponse>(path: string, body?: unknown, options?: Omit<RequestOptions, "body">) => AsyncResult<TResponse, ApiClientError>;
  put: <TResponse>(path: string, body?: unknown, options?: Omit<RequestOptions, "body">) => AsyncResult<TResponse, ApiClientError>;
  patch: <TResponse>(path: string, body?: unknown, options?: Omit<RequestOptions, "body">) => AsyncResult<TResponse, ApiClientError>;
  delete: <TResponse>(path: string, options?: Omit<RequestOptions, "body">) => AsyncResult<TResponse, ApiClientError>;
};

const genericRequestError = "No pudimos completar la solicitud. Intentá nuevamente.";
const networkError = "No pudimos conectarnos. Verificá tu conexión e intentá nuevamente.";
const clientRequestError = "No pudimos preparar la solicitud. Intentá nuevamente.";
const defaultTimeoutMs = 30_000;

/** Rejects as soon as the signal aborts, so a response that never finishes arriving does not hang the request. */
const untilAborted = <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      if (signal.aborted) {
        reject(new Error("TimeoutError"));
        return;
      }

      signal.addEventListener("abort", () => reject(new Error("TimeoutError")), { once: true });
    }),
  ]);

const joinUrl = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

const getErrorKind = (status: number): ApiErrorKind => {
  if (status === 401) {
    return "unauthorized";
  }

  if (status === 403) {
    return "forbidden";
  }

  if (status === 400 || status === 422) {
    return "validation";
  }

  if (status === 404) {
    return "not-found";
  }

  return "server";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseFields = (value: unknown): readonly ApiFieldError[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const fields = value.flatMap((item): ApiFieldError[] => {
    if (!isRecord(item)) {
      return [];
    }

    const { field, code, message } = item;

    if (
      typeof field !== "string" ||
      typeof code !== "string" ||
      typeof message !== "string"
    ) {
      return [];
    }

    return [{ field, code, message }];
  });

  return fields.length > 0 ? fields : undefined;
};

const toApiClientError = (status: number, payload: unknown): ApiClientError => {
  const apiError = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
  const errorCode = isRecord(payload) ? payload.error : undefined;
  const code =
    (apiError && typeof apiError.code === "string" && apiError.code) ||
    (typeof errorCode === "string" && errorCode) ||
    "HttpError";
  const message =
    (apiError && typeof apiError.message === "string" && apiError.message) ||
    genericRequestError;
  const fields = apiError ? parseFields(apiError.fields) : undefined;

  const error = new ApiClientError(getErrorKind(status), code, message, status, fields);

  if (status === 409 && code === "ParticipationConflictError" && apiError) {
    error.details = { conflicts: apiError.conflicts, activity: apiError.activity };
  }

  if (status === 409 && code === "PostRequestConflictError" && apiError) {
    if (typeof apiError.reason === "string") error.reason = apiError.reason;
    if (typeof apiError.postId === "string") error.postId = apiError.postId;
  }

  return error;
};

const toInvalidResponseError = (status: number): ApiClientError =>
  new ApiClientError("server", "InvalidResponse", genericRequestError, status);

export const createHttpClient = ({
  baseUrl,
  fetch,
  getAccessToken,
  onUnauthorized,
  timeoutMs = defaultTimeoutMs,
}: HttpClientDependencies): HttpClient => {
  const request = async <TResponse>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    options: RequestOptions = {},
  ): AsyncResult<TResponse, ApiClientError> => {
    const headers = { ...options.headers };

    if (options.authenticated !== false) {
      let accessToken: string | null;

      try {
        accessToken = await getAccessToken();
      } catch {
        return err(new ApiClientError("client", "AccessTokenError", clientRequestError));
      }

      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }
    }

    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let response: Response;

      try {
        response = await untilAborted(
          fetch(joinUrl(baseUrl, path), {
            method,
            headers,
            ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
            signal: controller.signal,
          }),
          controller.signal,
        );
      } catch {
        return err(
          controller.signal.aborted
            ? new ApiClientError("network", "TimeoutError", timeoutNotice)
            : new ApiClientError("network", "NetworkError", networkError),
        );
      }

      let payload: unknown;

      try {
        payload = response.status === 204 ? undefined : await untilAborted(response.json(), controller.signal);
      } catch {
        if (controller.signal.aborted) {
          return err(new ApiClientError("network", "TimeoutError", timeoutNotice));
        }

        if (response.ok) {
          return err(toInvalidResponseError(response.status));
        }

        payload = undefined;
      }

      if (response.ok) {
        return ok(payload as TResponse);
      }

      const error = toApiClientError(response.status, payload);

      if (error.kind === "unauthorized") {
        try {
          await onUnauthorized(headers.Authorization?.replace(/^Bearer /, "") ?? null);
        } catch {
          return err(error);
        }
      }

      return err(error);
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    get: (path, options) => request("GET", path, options),
    post: (path, body, options) => request("POST", path, { ...options, body }),
    put: (path, body, options) => request("PUT", path, { ...options, body }),
    patch: (path, body, options) => request("PATCH", path, { ...options, body }),
    delete: (path, options) => request("DELETE", path, options),
  };
};
