import { describe, expect, it, vi } from "vitest";

import {
  initializeAppUrlListener,
  type NativeAppUrlApi,
} from "./app-url-listener.js";

function createNativeAppUrlApi(launchUrl?: string): {
  api: NativeAppUrlApi;
  emitUrl: (url: string) => void;
  remove: ReturnType<typeof vi.fn>;
} {
  let listener: ((event: { url: string }) => void) | undefined;
  const remove = vi.fn().mockResolvedValue(undefined);

  return {
    api: {
      addListener: vi.fn(async (_eventName, callback) => {
        listener = callback;
        return { remove };
      }),
      getLaunchUrl: vi.fn().mockResolvedValue(launchUrl ? { url: launchUrl } : undefined),
    },
    emitUrl: (url) => listener?.({ url }),
    remove,
  };
}

describe("initializeAppUrlListener", () => {
  it("navigates to the URL that launched the application", async () => {
    const { api } = createNativeAppUrlApi("com.travellier.app://invite/VIAJE-X7K2");
    const navigate = vi.fn();

    await initializeAppUrlListener(api, navigate);

    expect(navigate).toHaveBeenCalledWith("/invite/VIAJE-X7K2");
  });

  it("navigates to URLs received after startup and removes its listener", async () => {
    const { api, emitUrl, remove } = createNativeAppUrlApi();
    const navigate = vi.fn();
    const stopListening = await initializeAppUrlListener(api, navigate);

    emitUrl("com.travellier.app://verify/token-123");
    await stopListening();

    expect(navigate).toHaveBeenCalledWith("/verify/token-123");
    expect(remove).toHaveBeenCalledOnce();
  });
});
