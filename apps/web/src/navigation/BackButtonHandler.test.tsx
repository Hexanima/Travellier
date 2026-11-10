// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackButtonHandler } from "./BackButtonHandler.js";
import { decideBack, type NativeBackButtonApi } from "./back-button.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });

const id = "a".repeat(24);
const postId = "b".repeat(24);
let go: NavigateFunction = () => undefined;
let where = { pathname: "", state: null as unknown };
function Probe() { go = useNavigate(); const l = useLocation(); where = { pathname: l.pathname, state: l.state }; return null; }

function fakePort() {
  let listener: ((event: { canGoBack: boolean }) => void) | undefined;
  const remove = vi.fn().mockResolvedValue(undefined);
  const port = { addListener: vi.fn(async (_name: "backButton", fn: (event: { canGoBack: boolean }) => void) => { listener = fn; return { remove }; }), exitApp: vi.fn().mockResolvedValue(undefined) };
  return { port: port as NativeBackButtonApi & typeof port, remove, press: (canGoBack = true) => act(async () => listener!({ canGoBack })) };
}
async function mount(entries: (string | { pathname: string; state?: unknown })[], port?: NativeBackButtonApi, index = entries.length - 1) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const render = (p?: NativeBackButtonApi) => act(async () => root.render(<MemoryRouter initialEntries={entries} initialIndex={index}><Probe /><BackButtonHandler nativeBack={p} /></MemoryRouter>));
  await render(port);
  return { root, render };
}

describe("decideBack", () => {
  const at = (pathname: string, key = "k1", state: unknown = null) => ({ pathname, key, state });
  it("uses the history when there is an entry behind in the router and in the webview", () => {
    expect(decideBack(at(`/trips/${id}/itinerary`), true)).toEqual({ kind: "history" });
    expect(decideBack(at(`/trips/${id}/memories/${postId}`), true)).toEqual({ kind: "history" });
    expect(decideBack(at("/trips"), true)).toEqual({ kind: "history" });
  });
  it("treats a webview without history, the initial entry and `noBack` as nothing behind", () => {
    expect(decideBack(at(`/trips/${id}/members`), false)).toEqual({ kind: "navigate", to: "/trips" });
    expect(decideBack(at(`/trips/${id}/members`, "default"), true)).toEqual({ kind: "navigate", to: "/trips" });
    expect(decideBack(at(`/trips/${id}/members`, "k2", { noBack: true }), true)).toEqual({ kind: "navigate", to: "/trips" });
  });
  it("a root of each tab without history leaves to Mis viajes", () => {
    for (const path of ["itinerary", "members", "memories", "memories/photos", "memories/"]) expect(decideBack(at(`/trips/${id}/${path}`, "default"), true), path).toEqual({ kind: "navigate", to: "/trips" });
  });
  it("another screen of the Trip without history goes to the diary of that Trip, with nothing behind", () => {
    for (const path of ["memories/new", `memories/${postId}`, "balance", "journey", "config"]) {
      expect(decideBack(at(`/trips/${id}/${path}`, "default"), true), path).toEqual({ kind: "navigate", to: `/trips/${id}/memories`, state: { noBack: true } });
    }
  });
  it("the app roots without history exit; other screens go to Mis viajes", () => {
    for (const path of ["/trips", "/trips/", "/", "/login", "/register"]) expect(decideBack(at(path, "default"), true), path).toEqual({ kind: "exit" });
    for (const path of ["/notifications", "/profile", "/trips/new", "/trips/join", "/trips/explore", `/trips/explore/${id}`, `/trips/${id}`]) expect(decideBack(at(path, "default"), true), path).toEqual({ kind: "navigate", to: "/trips" });
  });
});

describe("BackButtonHandler", () => {
  it("with history, Back goes back one entry", async () => {
    const { port, press } = fakePort();
    await mount(["/trips", `/trips/${id}/itinerary`, `/trips/${id}/memories/${postId}`], port);
    await press();
    expect(where.pathname).toBe(`/trips/${id}/itinerary`);
    expect(port.exitApp).not.toHaveBeenCalled();
  });
  it("a Trip root opened as the first entry (deep link without history) goes to Mis viajes replacing the entry", async () => {
    const { port, press } = fakePort();
    await mount([{ pathname: `/trips/${id}/itinerary` }], port);
    await press(false);
    expect(where.pathname).toBe("/trips");
    expect(port.exitApp).not.toHaveBeenCalled();
    await press(false); // now on /trips with nothing behind: exits
    expect(port.exitApp).toHaveBeenCalledTimes(1);
  });
  it("a Trip root replaced by a tab change (noBack) also goes to Mis viajes", async () => {
    const { port, press } = fakePort();
    await mount([{ pathname: `/trips/${id}/members`, state: { noBack: true } }, `/trips/${id}/members`], port, 0);
    await press();
    expect(where.pathname).toBe("/trips");
  });
  it("another Trip screen without history goes to the diary and then to Mis viajes", async () => {
    const { port, press } = fakePort();
    await mount([{ pathname: `/trips/${id}/balance` }], port);
    await press(false);
    expect(where.pathname).toBe(`/trips/${id}/memories`);
    expect((where.state as { noBack?: boolean }).noBack).toBe(true);
    await press();
    expect(where.pathname).toBe("/trips");
  });
  it("on /trips without history it exits the app", async () => {
    const { port, press } = fakePort();
    await mount(["/trips"], port);
    await press(false);
    expect(port.exitApp).toHaveBeenCalledTimes(1);
    expect(where.pathname).toBe("/trips");
  });
  it("a failing exitApp does not throw", async () => {
    const { port, press } = fakePort();
    port.exitApp.mockRejectedValue(new Error("native"));
    await mount(["/trips"], port);
    await press(false);
    expect(port.exitApp).toHaveBeenCalledTimes(1);
  });
  it("registers once even across navigation and rerenders, and removes the listener on unmount", async () => {
    const { port, remove } = fakePort();
    const { root, render } = await mount(["/trips"], port);
    await act(async () => go("/profile"));
    await render(port);
    expect(port.addListener).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    expect(remove).toHaveBeenCalledTimes(1);
  });
  it("removes a listener that resolves after unmounting", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    let resolve!: (value: { remove: typeof remove }) => void;
    const port = { addListener: vi.fn(() => new Promise<{ remove: typeof remove }>((r) => { resolve = r; })), exitApp: vi.fn() };
    const { root } = await mount(["/trips"], port as never);
    await act(async () => root.unmount());
    await act(async () => resolve({ remove }));
    expect(remove).toHaveBeenCalledTimes(1);
  });
  it("does nothing without a port (web)", async () => {
    await mount(["/trips"], undefined);
    expect(where.pathname).toBe("/trips");
  });
});
