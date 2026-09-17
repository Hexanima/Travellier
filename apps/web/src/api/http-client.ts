import { err, ok, type AsyncResult, TaggedError } from "app-domain";

export type ApiErrorKind =
  | "client"
  | "network"
  | "unauthorized"
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
  onUnauthorized: () => void | Promise<void>;
};

type RequestOptions = {
  headers?: Record<string, string>;
  body?: unknown;
  authenticated?: boolean;
};

export type HttpClient = {
  get: <TResponse>(path: string, options?: Omit<RequestOptions, "body">) => AsyncResult<TResponse, ApiClientError>;
  post: <TResponse>(path: string, body?: unknown, options?: Omit<RequestOptions, "body">) => AsyncResult<TResponse, ApiClientError>;
};

const genericRequestError = "No pudimos completar la solicitud. Intentá nuevamente.";
const networkError = "No pudimos conectarnos. Verificá tu conexión e intentá nuevamente.";
const clientRequestError = "No pudimos preparar la solicitud. Intentá nuevamente.";

const joinUrl = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

const getErrorKind = (status: number): ApiErrorKind => {
  if (status === 401) {
    return "unauthorized";
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

  return new ApiClientError(getErrorKind(status), code, message, status, fields);
};

const toInvalidResponseError = (status: number): ApiClientError =>
  new ApiClientError("server", "InvalidResponse", genericRequestError, status);

export const createHttpClient = ({
  baseUrl,
  fetch,
  getAccessToken,
  onUnauthorized,
}: HttpClientDependencies): HttpClient => {
  const request = async <TResponse>(
    method: "GET" | "POST",
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

    let response: Response;

    try {
      response = await fetch(joinUrl(baseUrl, path), {
        method,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch {
      return err(new ApiClientError("network", "NetworkError", networkError));
    }

    let payload: unknown;

    try {
      payload = response.status === 204 ? undefined : await response.json();
    } catch {
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
        await onUnauthorized();
      } catch {
        return err(error);
      }
    }

    return err(error);
  };

  return {
    get: (path, options) => request("GET", path, options),
    post: (path, body, options) => request("POST", path, { ...options, body }),
  };
};
