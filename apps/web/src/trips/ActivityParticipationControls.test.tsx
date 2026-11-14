// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityParticipationControls } from "./ActivityParticipationControls.js";
import type { TripFailure } from "./trip-management-api.js";
import type { ParticipationState } from "./use-activity-participations.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });

const render = async (state: ParticipationState) => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<ActivityParticipationControls title="Caminata" state={state} onChange={vi.fn()} onRetry={vi.fn()} />));
  return container;
};
const alert = (container: HTMLElement) => container.querySelector('[role="alert"]')?.textContent;
const retry = (container: HTMLElement) => Array.from(container.querySelectorAll("button")).some((item) => item.textContent === "Reintentar");
const saveFailed = (error: TripFailure): ParticipationState => ({ kind: "ready", status: "going", error, failedStatus: "not_going" });
const loadFailed = (error: TripFailure): ParticipationState => ({ kind: "error", error });

describe("ActivityParticipationControls: causa del fallo de red (T150)", () => {
  it("un timeout al guardar la participación tiene su propio texto y conserva la respuesta anterior", async () => {
    const container = await render(saveFailed({ kind: "network", code: "TimeoutError" }));
    expect(alert(container)).toBe("La conexión tardó demasiado. Intentá nuevamente. Tu respuesta anterior se conserva.");
    expect(container.textContent).not.toContain("No pudimos guardar tu participación");
    expect(retry(container)).toBe(true);
  });
  it("una conexión caída al guardar la participación conserva el texto de siempre", async () => {
    const container = await render(saveFailed({ kind: "network", code: "NetworkError" }));
    expect(alert(container)).toBe("No pudimos guardar tu participación. Tu respuesta anterior se conserva. Intentá nuevamente.");
    expect(container.textContent).not.toContain("tardó demasiado");
  });
  it("un timeout al cargar la participación tiene su propio texto y conserva el reintento", async () => {
    const container = await render(loadFailed({ kind: "network", code: "TimeoutError" }));
    expect(alert(container)).toBe("La conexión tardó demasiado. Intentá nuevamente.");
    expect(container.textContent).not.toContain("No pudimos cargar tu participación");
    expect(retry(container)).toBe(true);
  });
  it("una conexión caída al cargar la participación conserva el texto de siempre", async () => {
    const container = await render(loadFailed({ kind: "network", code: "NetworkError" }));
    expect(alert(container)).toBe("No pudimos cargar tu participación. Revisá tu conexión e intentá nuevamente.");
    expect(container.textContent).not.toContain("tardó demasiado");
  });
});
