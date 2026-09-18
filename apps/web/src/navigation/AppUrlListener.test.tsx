// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppUrlListener } from "./AppUrlListener.js";
import type { NativeAppUrlApi } from "./app-url-listener.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mountedRoots: ReturnType<typeof createRoot>[] = [];

afterEach(async () => {
  await act(async () => {
    mountedRoots.splice(0).forEach((root) => root.unmount());
  });
});

function CurrentPath() {
  return <output>{useLocation().pathname}</output>;
}

describe("AppUrlListener", () => {
  it("connects a launch URL to React Router navigation", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const nativeApp: NativeAppUrlApi = {
      addListener: vi.fn().mockResolvedValue({ remove }),
      getLaunchUrl: vi.fn().mockResolvedValue({
        url: "com.travellier.app://invite/VIAJE-X7K2",
      }),
    };
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/"]}>
          <AppUrlListener nativeApp={nativeApp} />
          <CurrentPath />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toBe("/invite/VIAJE-X7K2");
  });
});
