// @vitest-environment jsdom
import { act, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppLifecycle } from "../native/app-lifecycle.js";
import { TripRefreshProvider, useRefreshGuard, useRefreshNow, useTripRefreshLoader, type RefreshOutcome } from "./trip-refresh.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
let visibility: DocumentVisibilityState = "visible";
const setVisibility = async (value: DocumentVisibilityState) => { visibility = value; await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); };
const focus = () => act(async () => { window.dispatchEvent(new Event("focus")); });

type Load = (ctx: { signal: AbortSignal }) => Promise<RefreshOutcome>;
const Probe = ({ id = "list", load, guard = false }: { id?: string; load: Load; guard?: boolean }) => {
  useTripRefreshLoader(id, load);
  useRefreshGuard(guard);
  const refreshNow = useRefreshNow();
  return <button type="button" data-action="refresh" onClick={() => void refreshNow()}>Actualizar</button>;
};
const Where = () => { const location = useLocation(); return <p data-testid="where">{location.pathname}|{JSON.stringify(location.state)}</p>; };
const press = (selector: string) => act(async () => { document.querySelector<HTMLElement>(selector)!.click(); });
const shown = (text: string) => document.body.textContent?.includes(text) ?? false;

const mount = async (ui: ReactNode, { lifecycle }: { lifecycle?: AppLifecycle } = {}) => {
  const root = createRoot(document.body.appendChild(document.createElement("div"))); roots.push(root);
  await act(async () => root.render(
    <MemoryRouter initialEntries={["/trips/t1/x"]}>
      <Where />
      <Routes>
        <Route path="/trips" element={<p>Mis viajes</p>} />
        <Route path="/trips/:tripId/x" element={<TripRefreshProvider tripId="t1" lifecycle={lifecycle}>{ui}</TripRefreshProvider>} />
      </Routes>
    </MemoryRouter>));
  return { unmount: () => act(async () => root.unmount()) };
};
const ok = async (): Promise<RefreshOutcome> => ({ status: "ok" });
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z")); visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
  vi.useRealTimers();
  delete (document as { visibilityState?: unknown }).visibilityState;
});

describe("TripRefreshProvider", () => {
  it("no refresca al montar; refresca cada 45 s con la pantalla visible", async () => {
    const load = vi.fn(ok);
    await mount(<Probe load={load} />);
    await tick(44_000);
    expect(load).not.toHaveBeenCalled();
    await tick(1_000);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]![0].signal.aborted).toBe(false);
    await tick(45_000);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("no refresca en segundo plano ni con un focus suelto", async () => {
    const load = vi.fn(ok);
    await mount(<Probe load={load} />);
    await setVisibility("hidden");
    await tick(200_000);
    await focus();
    expect(load).not.toHaveBeenCalled();
  });

  it("refresca al volver a primer plano y junta visibilitychange con focus (hueco de 1 s)", async () => {
    const load = vi.fn(ok);
    await mount(<Probe load={load} />);
    await setVisibility("hidden");
    await tick(5_000);
    await setVisibility("visible"); await focus();
    expect(load).toHaveBeenCalledTimes(1);
    await tick(1_500);
    await focus();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("refresca con la señal nativa de reanudar y deja de escucharla al desmontar", async () => {
    let resume: (() => void) | undefined;
    const stop = vi.fn();
    const lifecycle: AppLifecycle = { onResume: (listener) => { resume = listener; return stop; } };
    const load = vi.fn(ok);
    const view = await mount(<Probe load={load} />, { lifecycle });
    await tick(2_000);
    await act(async () => { resume?.(); });
    expect(load).toHaveBeenCalledTimes(1);
    await view.unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("no inicia un segundo request si hay uno en curso (intervalo, manual)", async () => {
    let release: (() => void) | undefined;
    const load = vi.fn(() => new Promise<RefreshOutcome>((resolve) => { release = () => resolve({ status: "ok" }); }));
    await mount(<Probe load={load} />);
    await tick(45_000);
    expect(load).toHaveBeenCalledTimes(1);
    await press("[data-action=refresh]");
    await tick(45_000);
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => { release?.(); });
    await press("[data-action=refresh]");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("solo corren los loaders de las pantallas montadas", async () => {
    const first = vi.fn(ok), second = vi.fn(ok);
    const view = await mount(<><Probe id="a" load={first} /><Probe id="b" load={second} /></>);
    await tick(45_000);
    expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(1);
    await view.unmount();
    await mount(<Probe id="a" load={first} />);
    await tick(45_000);
    expect(first).toHaveBeenCalledTimes(2); expect(second).toHaveBeenCalledTimes(1);
  });

  it("con una pausa activa no refresca y al soltarla refresca una vez", async () => {
    const load = vi.fn(ok);
    const Toggle = () => { const [on, setOn] = useState(true); return <><button type="button" data-action="release" onClick={() => setOn(false)}>Soltar</button><Probe load={load} guard={on} /></>; };
    await mount(<Toggle />);
    await tick(200_000);
    expect(load).not.toHaveBeenCalled();
    await press("[data-action=release]");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("al desmontar detiene el intervalo y aborta el refresco en curso", async () => {
    let signal: AbortSignal | undefined;
    const load = vi.fn((ctx: { signal: AbortSignal }) => { signal = ctx.signal; return new Promise<RefreshOutcome>(() => undefined); });
    const view = await mount(<Probe load={load} />);
    await tick(45_000);
    expect(signal?.aborted).toBe(false);
    await view.unmount();
    expect(signal?.aborted).toBe(true);
    await tick(200_000);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("descarta la respuesta tardía de un refresco abortado (no navega)", async () => {
    let release: ((outcome: RefreshOutcome) => void) | undefined;
    const load = vi.fn(() => new Promise<RefreshOutcome>((resolve) => { release = resolve; }));
    const view = await mount(<Probe load={load} />);
    await tick(45_000);
    await view.unmount();
    await act(async () => { release?.({ status: "gone" }); });
    expect(shown("Mis viajes")).toBe(false);
  });

  it("ante «gone» vuelve a Mis viajes con una marca genérica y sin datos del Trip", async () => {
    const load = vi.fn(async (): Promise<RefreshOutcome> => ({ status: "gone" }));
    await mount(<Probe load={load} />);
    await tick(45_000);
    expect(shown("Mis viajes")).toBe(true);
    expect(document.querySelector("[data-testid=where]")!.textContent).toBe('/trips|{"tripGone":true}');
  });

  it("un fallo secundario o de sesión no navega", async () => {
    for (const status of ["error", "unauthorized"] as const) {
      const load = vi.fn(async (): Promise<RefreshOutcome> => ({ status }));
      const view = await mount(<Probe load={load} />);
      await tick(45_000);
      expect(load).toHaveBeenCalled();
      expect(shown("Mis viajes")).toBe(false);
      await view.unmount();
    }
  });

  it("una excepción del loader no rompe el ticker ni navega", async () => {
    const load = vi.fn(async (): Promise<RefreshOutcome> => { throw new Error("boom"); });
    await mount(<Probe load={load} />);
    await tick(90_000);
    expect(load).toHaveBeenCalledTimes(2);
    expect(shown("Mis viajes")).toBe(false);
  });

  it("sin proveedor los hooks no hacen nada", async () => {
    const load = vi.fn(ok);
    const root = createRoot(document.body.appendChild(document.createElement("div"))); roots.push(root);
    await act(async () => root.render(<Probe load={load} guard />));
    await press("[data-action=refresh]");
    await tick(100_000);
    expect(load).not.toHaveBeenCalled();
  });
});
