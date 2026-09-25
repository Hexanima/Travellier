import type { ApiClientError, ApiErrorKind, HttpClient } from "../api/index.js";

export type AuthenticatedSession = {
  accessToken: string;
  refreshToken: string;
};

export type AuthenticatedProfile = {
  name: string;
  email: string;
  avatar: string | null;
};

export type AuthFailure = {
  kind: ApiErrorKind;
  fields?: readonly { field: string; message: string }[];
};

export type AuthResult<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; error: AuthFailure };

export type AuthApi = {
  login: (payload: { email: string; password: string }) => Promise<AuthResult<AuthenticatedSession>>;
  refresh: (payload: { refreshToken: string }) => Promise<AuthResult<AuthenticatedSession>>;
  register: (payload: { email: string; name: string; password: string }) => Promise<AuthResult<{ id: string }>>;
  getProfile: () => Promise<AuthResult<AuthenticatedProfile>>;
  updateProfile: (payload: { name?: string; avatar?: string | null }) => Promise<AuthResult<AuthenticatedProfile>>;
  uploadAvatar: (file: File) => Promise<AuthResult<{ avatar: string }>>;
  getAvatarUrl: () => Promise<AuthResult<{ url: string | null }>>;
};

type RegistrationResponse = { user: { id: string } };
type ProfileResponse = { profile: AuthenticatedProfile };
type AvatarUploadResponse = { avatar: string; uploadUrl: string; headers: Record<string, string> };

const toFailure = (error: ApiClientError): AuthFailure =>
  error.kind === "validation" && error.fields !== undefined
    ? { kind: error.kind, fields: error.fields.map(({ field, message }) => ({ field, message })) }
    : { kind: error.kind };

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

const isAuthenticatedProfile = (value: unknown): value is AuthenticatedProfile =>
  typeof value === "object" &&
  value !== null &&
  "name" in value &&
  typeof value.name === "string" &&
  "email" in value &&
  typeof value.email === "string" &&
  "avatar" in value &&
  (typeof value.avatar === "string" || value.avatar === null);

const isProfileResponse = (value: unknown): value is ProfileResponse =>
  typeof value === "object" &&
  value !== null &&
  "profile" in value &&
  isAuthenticatedProfile(value.profile);

const isAvatarUploadResponse = (value: unknown): value is AvatarUploadResponse =>
  typeof value === "object" && value !== null &&
  "avatar" in value && typeof value.avatar === "string" &&
  "uploadUrl" in value && typeof value.uploadUrl === "string" &&
  "headers" in value && typeof value.headers === "object" && value.headers !== null &&
  Object.entries(value.headers).every(([key, header]) => typeof key === "string" && typeof header === "string");

const isAvatarUrlResponse = (value: unknown): value is { url: string | null } =>
  typeof value === "object" && value !== null && "url" in value &&
  (typeof value.url === "string" || value.url === null);

export const createAuthApi = (
  client: Pick<HttpClient, "get" | "patch" | "post">,
  upload: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init),
): AuthApi => ({
  register: async (payload) => {
    const result = await client.post<RegistrationResponse>("/auth/register", payload, {
      authenticated: false,
    });

    if (!result.ok) {
      return { ok: false, error: toFailure(result.error) };
    }

    return isRegistrationResponse(result.value)
      ? { ok: true, value: result.value.user }
      : { ok: false, error: { kind: "server" } };
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
      : { ok: false, error: { kind: "server" } };
  },
  refresh: async (payload) => {
    const result = await client.post<AuthenticatedSession>("/auth/refresh", payload, {
      authenticated: false,
    });

    if (!result.ok) {
      return { ok: false, error: toFailure(result.error) };
    }

    return isAuthenticatedSession(result.value)
      ? { ok: true, value: result.value }
      : { ok: false, error: { kind: "server" } };
  },
  getProfile: async () => {
    const result = await client.get<ProfileResponse>("/profile");

    if (!result.ok) {
      return { ok: false, error: toFailure(result.error) };
    }

    return isProfileResponse(result.value)
      ? { ok: true, value: result.value.profile }
      : { ok: false, error: { kind: "server" } };
  },
  updateProfile: async (payload) => {
    const result = await client.patch<ProfileResponse>("/profile", payload);

    if (!result.ok) {
      return { ok: false, error: toFailure(result.error) };
    }

    return isProfileResponse(result.value)
      ? { ok: true, value: result.value.profile }
      : { ok: false, error: { kind: "server" } };
  },
  uploadAvatar: async (file) => {
    const target = await client.post<AvatarUploadResponse>("/profile/avatar-upload", { contentType: file.type });
    if (!target.ok) return { ok: false, error: toFailure(target.error) };
    if (!isAvatarUploadResponse(target.value)) return { ok: false, error: { kind: "server" } };

    try {
      const response = await upload(target.value.uploadUrl, {
        method: "PUT", headers: target.value.headers, body: file,
      });
      return response.ok
        ? { ok: true, value: { avatar: target.value.avatar } }
        : { ok: false, error: { kind: "server" } };
    } catch {
      return { ok: false, error: { kind: "network" } };
    }
  },
  getAvatarUrl: async () => {
    const result = await client.get<{ url: string | null }>("/profile/avatar-url");
    if (!result.ok) return { ok: false, error: toFailure(result.error) };
    return isAvatarUrlResponse(result.value)
      ? { ok: true, value: result.value }
      : { ok: false, error: { kind: "server" } };
  },
});
