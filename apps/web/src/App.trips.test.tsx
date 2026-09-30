// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App.js";
import type { NativeSessionStorage } from "./auth/native-session-storage.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
});

const storage = (session: boolean): NativeSessionStorage => ({
  read: vi.fn().mockResolvedValue(session ? { accessToken: "access", refreshToken: "refresh" } : null),
  save: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
});

async function render(path: string, session: boolean, trips: Record<string, unknown>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(
    <MemoryRouter initialEntries={[path]}>
      <App
        auth={{ refresh: vi.fn().mockResolvedValue({ ok: true, value: { accessToken: "new", refreshToken: "new-refresh" } }) }}
        sessionStorage={storage(session)}
        trips={trips as never}
      />
    </MemoryRouter>,
  ));
  return container;
}

describe("App Trip routes", () => {
  it("guards the Trip list without requesting private data before login", async () => {
    const list = vi.fn();
    const container = await render("/trips", false, { list });

    expect(container.textContent).toContain("Iniciar sesión");
    expect(container.textContent).not.toContain("Mis viajes");
    expect(list).not.toHaveBeenCalled();
  });

  it("loads the list after restoring a session", async () => {
    const list = vi.fn().mockResolvedValue({ ok: true, value: [] });
    const container = await render("/trips", true, { list });

    expect(list).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Mis viajes");
    expect(container.textContent).toContain("Todavía no tenés viajes");
  });

  it("opens the creation screen only for a signed-in user", async () => {
    const create = vi.fn();
    const publicView = await render("/trips/new", false, { create });
    expect(publicView.textContent).toContain("Iniciar sesión");
    expect(create).not.toHaveBeenCalled();

    const privateView = await render("/trips/new", true, { create });
    expect(privateView.textContent).toContain("Crear viaje");
    expect(privateView.querySelector('[name="primaryDestination"]')).not.toBeNull();
    expect(privateView.querySelector('input[type="date"]')).toBeNull();
  });
});
