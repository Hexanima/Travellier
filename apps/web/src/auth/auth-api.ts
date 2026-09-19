import type { ApiClientError, HttpClient } from "../api/index.js";

export type AuthenticatedSession = {
  accessToken: string;
  refreshToken: string;
};

export type AuthFailure = {
  fields?: readonly { field: string; message: string }[];
};

export type AuthResult<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; error: AuthFailure };

export type AuthApi = {
  login: (payload: { email: string; password: string }) => Promise<AuthResult<AuthenticatedSession>>;
  register: (payload: { email: string; name: string; password: string }) => Promise<AuthResult<{ id: string }>>;
};

type RegistrationResponse = { user: { id: string } };

const toFailure = (error: ApiClientError): AuthFailure =>
  error.kind === "validation" && error.fields !== undefined
    ? { fields: error.fields.map(({ field, message }) => ({ field, message })) }
    : {};

const isRegistrationResponse = (value: unknown): value is RegistrationResponse =>
  typeof value === "object" &&
  value !== null &&
  "user" in value &&
  typeof value.user === "object" &&
  value.user !== null &&
  "id" in value.user &&
  typeof value.user.id === "string";

const isAuthenticatedSession = (value: unknown): value is AuthenticatedSession =>
  typeof value === "object" &&
  value !== null &&
  "accessToken" in value &&
  typeof value.accessToken === "string" &&
  "refreshToken" in value &&
  typeof value.refreshToken === "string";

export const createAuthApi = (client: Pick<HttpClient, "post">): AuthApi => ({
  register: async (payload) => {
    const result = await client.post<RegistrationResponse>("/auth/register", payload, {
      authenticated: false,
    });

    if (!result.ok) {
      return { ok: false, error: toFailure(result.error) };
    }

    return isRegistrationResponse(result.value)
      ? { ok: true, value: result.value.user }
      : { ok: false, error: {} };
  },
  login: async (payload) => {
    const result = await client.post<AuthenticatedSession>("/auth/login", payload, {
      authenticated: false,
    });

    if (!result.ok) {
      return { ok: false, error: toFailure(result.error) };
    }

    return isAuthenticatedSession(result.value)
      ? { ok: true, value: result.value }
      : { ok: false, error: {} };
  },
});
