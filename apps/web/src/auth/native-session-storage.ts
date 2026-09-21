import type { AuthenticatedSession } from "./auth-api.js";

const sessionKey = "travellier.session";

export type PreferencesApi = {
  get: (options: { key: string }) => Promise<{ value: string | null }>;
  set: (options: { key: string; value: string }) => Promise<void>;
  remove: (options: { key: string }) => Promise<void>;
};

export type NativeSessionStorage = {
  clear: () => Promise<void>;
  read: () => Promise<AuthenticatedSession | null>;
  save: (session: AuthenticatedSession) => Promise<void>;
};

const isAuthenticatedSession = (value: unknown): value is AuthenticatedSession =>
  typeof value === "object" &&
  value !== null &&
  "accessToken" in value &&
  typeof value.accessToken === "string" &&
  "refreshToken" in value &&
  typeof value.refreshToken === "string";

export const createNativeSessionStorage = (
  preferences: PreferencesApi,
): NativeSessionStorage => ({
  clear: () => preferences.remove({ key: sessionKey }),
  read: async () => {
    const { value } = await preferences.get({ key: sessionKey });

    if (value === null) {
      return null;
    }

    try {
      const session: unknown = JSON.parse(value);

      return isAuthenticatedSession(session) ? session : null;
    } catch {
      return null;
    }
  },
  save: (session) =>
    preferences.set({ key: sessionKey, value: JSON.stringify(session) }),
});
