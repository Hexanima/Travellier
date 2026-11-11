// T104: monta la App REAL (createHttpClient + APIs de apps/web + UI) contra el handler real de la API del harness T103.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { expect, vi } from "vitest";
import { startE2EHarness, type E2EHarness } from "../../../api/test/e2e-harness.js";
import App from "../../src/App.js";
import type { AuthenticatedSession } from "../../src/auth/auth-api.js";
import type { NativeSessionStorage } from "../../src/auth/native-session-storage.js";
import type { AppLifecycle } from "../../src/native/app-lifecycle.js";
import type { PostPhotoDeps } from "../../src/trips/use-post-photos.js";
import { type FakeDevice } from "./fake-device.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Arranca el harness (mongod en memoria + handler real). Cerrar siempre con `harness.close()` en afterAll. */
export const startHarness = (name: string): Promise<E2EHarness> => startE2EHarness(name);

/** Almacenamiento de sesion en memoria; `current` permite inspeccionar lo guardado. */
export function fakeSessionStorage(initial: AuthenticatedSession | null): NativeSessionStorage & { current: AuthenticatedSession | null } {
  const box = { current: initial };
  return {
    get current() { return box.current; },
    read: async () => box.current,
    // El refresh token rota en cada restauracion: se escribe sobre el mismo objeto para que el siguiente montaje de la misma persona lo herede.
    save: async (session: AuthenticatedSession) => { if (initial !== null) Object.assign(initial, session); box.current = initial ?? session; },
    clear: async () => { box.current = null; },
  } as NativeSessionStorage & { current: AuthenticatedSession | null };
}

/** Ciclo de vida simulado: `resume()` equivale a volver a primer plano. */
export function fakeLifecycle() {
  let listener: (() => void) | undefined;
  const lifecycle: AppLifecycle = { onResume: (next) => { listener = next; return () => { if (listener === next) listener = undefined; }; } };
  return { lifecycle, resume: () => act(async () => { listener?.(); await Promise.resolve(); }) };
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const text = () => document.body.textContent ?? "";

/** Deja correr promesas y renders pendientes (red real incluida) hasta que `condition` se cumple. */
export async function waitFor(condition: () => boolean, label: string, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    await act(async () => { await sleep(15); });
    if (condition()) return;
    if (Date.now() - started > timeoutMs) throw new Error(`Timeout esperando: ${label}\n--- pantalla ---\n${text().slice(0, 1500)}`);
  }
}
export const settle = async (rounds = 6) => { for (let i = 0; i < rounds; i += 1) await act(async () => { await sleep(10); }); };

export const waitForText = (expected: string, timeoutMs?: number) => waitFor(() => text().includes(expected), `texto «${expected}»`, timeoutMs);
export const waitForGone = (expected: string, timeoutMs?: number) => waitFor(() => !text().includes(expected), `ausencia de «${expected}»`, timeoutMs);

export const button = (label: string, scope: ParentNode = document.body) =>
  Array.from(scope.querySelectorAll("button")).find((item) => item.textContent?.trim() === label || item.getAttribute("aria-label") === label) as HTMLButtonElement | undefined;
export const linkByText = (label: string, scope: ParentNode = document.body) =>
  Array.from(scope.querySelectorAll("a")).find((item) => item.textContent?.trim() === label) as HTMLAnchorElement | undefined;
export const click = async (element: Element | undefined | null, label = "elemento") => {
  expect(element, `No se encontro ${label}\n${text().slice(0, 800)}`).toBeTruthy();
  await act(async () => { element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
};
export const clickButton = (label: string, scope?: ParentNode) => click(button(label, scope), `boton «${label}»`);
export const clickLink = (label: string) => click(linkByText(label), `enlace «${label}»`);
export async function type(name: string, value: string, scope: ParentNode = document.body) {
  const element = scope.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  expect(element, `Campo ${name}`).not.toBeNull();
  const proto = element!.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : element!.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const event = element!.tagName === "SELECT" ? "change" : "input";
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value); element!.dispatchEvent(new Event(event, { bubbles: true })); });
}
/** Escribe en un control identificado por prefijo de `aria-label` (filas de pagos y reparto). */
export async function typeByAria(prefix: string, value: string, scope: ParentNode = document.body) {
  const element = scope.querySelector(`[aria-label^="${prefix}"]`) as HTMLInputElement | HTMLSelectElement | null;
  expect(element, `Control «${prefix}»
${text().slice(0, 600)}`).not.toBeNull();
  const select = element!.tagName === "SELECT";
  const proto = select ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value); element!.dispatchEvent(new Event(select ? "change" : "input", { bubbles: true })); });
}
/** Marca la opcion de radio cuyo texto de etiqueta empieza con `label`. */
export const chooseRadio = (label: string) => click(Array.from(document.querySelectorAll("label")).find((item) => item.textContent?.trim().startsWith(label))?.querySelector("input"), `opcion «${label}»`);
export const submit = (scope: ParentNode = document.body) =>
  act(async () => { scope.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });

let here = { path: "" };
let go: NavigateFunction = () => undefined;
function Spy() { go = useNavigate(); const location = useLocation(); here = { path: location.pathname }; return null; }
export const currentPath = () => here.path;
export const navigate = (to: string) => act(async () => { void go(to); });

export type MountOptions = {
  harness: E2EHarness;
  session: AuthenticatedSession | null;
  entry: string;
  device?: FakeDevice;
  lifecycle?: AppLifecycle;
  /** Reemplazos puntuales de las dependencias de dispositivo (por ejemplo `now`). */
  devicePhotos?: Partial<Omit<PostPhotoDeps, "api">>;
};
export type Mounted = { root: Root; container: HTMLElement; storage: ReturnType<typeof fakeSessionStorage>; unmount: () => Promise<void> };

const mounted: Mounted[] = [];
/** Monta la App sin pasar auth/trips/itinerary/...: usa createHttpClient y las APIs reales contra `harness.baseUrl`. */
export async function mountApp(options: MountOptions): Promise<Mounted> {
  const storage = fakeSessionStorage(options.session);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const device = options.device;
  const devicePhotos = { ...(device ? { source: device.source, reader: device.reader, transfer: device.transfer } : {}), ...options.devicePhotos } as Partial<Omit<PostPhotoDeps, "api">>;
  await act(async () => root.render(
    <MemoryRouter initialEntries={[options.entry]}>
      <Spy />
      <App apiBaseUrl={options.harness.baseUrl} sessionStorage={storage} lifecycle={options.lifecycle ?? fakeLifecycle().lifecycle} devicePhotos={devicePhotos} />
    </MemoryRouter>));
  const result: Mounted = { root, container, storage, unmount: async () => { const index = mounted.indexOf(result); if (index >= 0) mounted.splice(index, 1); await act(async () => root.unmount()); container.remove(); } };
  mounted.push(result);
  return result;
}

/** Desmonta todo lo montado (afterEach): simula cerrar la app; el estado del servidor sigue en el harness. */
export async function unmountAll(): Promise<void> {
  await settle(2);
  await act(async () => mounted.splice(0).forEach((item) => item.root.unmount()));
  document.body.replaceChildren();
}

/** jsdom conserva el fetch de Node; si algun entorno lo perdiera, falla con un mensaje claro. */
export function ensureNodeFetch(): void {
  if (typeof globalThis.fetch !== "function") throw new Error("El entorno no tiene fetch: no se puede hablar con el handler real.");
}

export function prepareDom(): void {
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as never;
}

export type FetchFault = {
  method: string;
  path: RegExp;
  /** `before`: la solicitud nunca llega al servidor; `after`: el servidor la procesa pero la respuesta se pierde. */
  mode: "before" | "after";
  times?: number;
};
/**
 * Falla de red controlada sobre el fetch que usa la App: solo afecta solicitudes que coinciden con una regla (las llamadas del
 * harness a otras rutas pasan intactas). Devuelve `restore` y los intentos observados.
 */
export function injectFetchFaults(faults: FetchFault[]) {
  const real = globalThis.fetch;
  const remaining = faults.map((fault) => ({ ...fault, left: fault.times ?? 1 }));
  const seen: Array<{ method: string; path: string; faulted: boolean }> = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    const path = new URL(url).pathname;
    const fault = remaining.find((item) => item.left > 0 && item.method === method && item.path.test(path));
    seen.push({ method, path, faulted: fault !== undefined });
    if (!fault) return real(input, init);
    fault.left -= 1;
    if (fault.mode === "after") await (await real(input, init)).text();
    throw new TypeError("Failed to fetch (simulado)");
  }) as typeof fetch;
  return { seen, restore: () => { globalThis.fetch = real; } };
}
