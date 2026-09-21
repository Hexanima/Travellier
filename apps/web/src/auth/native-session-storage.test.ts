import { describe, expect, it, vi } from "vitest";

import {
  createNativeSessionStorage,
  type PreferencesApi,
} from "./native-session-storage.js";

const session = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
};

const createPreferences = (): PreferencesApi => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
});

describe("createNativeSessionStorage", () => {
  it("persists both tokens through Capacitor Preferences", async () => {
    const preferences = createPreferences();
    const storage = createNativeSessionStorage(preferences);

    await storage.save(session);

    expect(preferences.set).toHaveBeenCalledWith({
      key: "travellier.session",
      value: JSON.stringify(session),
    });
  });

  it("restores a complete persisted session", async () => {
    const preferences = createPreferences();
    vi.mocked(preferences.get).mockResolvedValue({ value: JSON.stringify(session) });
    const storage = createNativeSessionStorage(preferences);

    await expect(storage.read()).resolves.toEqual(session);
  });

  it("clears the persisted session on local logout", async () => {
    const preferences = createPreferences();
    const storage = createNativeSessionStorage(preferences);

    await storage.clear();

    expect(preferences.remove).toHaveBeenCalledWith({ key: "travellier.session" });
  });

  it("ignores incomplete persisted data", async () => {
    const preferences = createPreferences();
    vi.mocked(preferences.get).mockResolvedValue({ value: JSON.stringify({ accessToken: "only-token" }) });
    const storage = createNativeSessionStorage(preferences);

    await expect(storage.read()).resolves.toBeNull();
  });
});
