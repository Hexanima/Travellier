// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mountedRoots: ReturnType<typeof createRoot>[] = [];

afterEach(async () => {
  await act(async () => {
    mountedRoots.splice(0).forEach((root) => root.unmount());
  });
  document.body.replaceChildren();
});

const setValue = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("App authentication", () => {
  it("navigates to the protected area after a successful login", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mountedRoots.push(root);
    const login = vi.fn().mockResolvedValue({
      ok: true,
      value: { accessToken: "access-token", refreshToken: "refresh-token" },
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/login"]}>
          <App auth={{ login }} />
        </MemoryRouter>,
      );
    });

    await setValue(container.querySelector("[name=email]") as HTMLInputElement, "nico@example.test");
    await setValue(container.querySelector("[name=password]") as HTMLInputElement, "secret-pass");
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(login).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Acceso protegido");
  });
});
