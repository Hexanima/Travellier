// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShellFrame, TripProvider } from "./trip-context.js";
import { useInTripShell, useTripName } from "./trip-state.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const tripA = "0123456789abcdef01234567", tripB = "0123456789abcdef01234568";
const detail = (name: string) => ({ ok: true as const, value: { id: tripA, kind: "member" as const, name } });

function Probe() { return <p data-probe>{`${useTripName()}|${useInTripShell()}`}</p>; }
async function render(node: React.ReactNode) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(node));
  return { container, rerender: (next: React.ReactNode) => act(async () => root.render(next)) };
}
const probe = (c: HTMLElement) => c.querySelector("[data-probe]")?.textContent;

describe("TripProvider", () => {
  it("asks the Trip once and exposes its name without blocking the children", async () => {
    let resolve!: (value: unknown) => void;
    const get = vi.fn(() => new Promise((r) => { resolve = r; }));
    const { container } = await render(<TripProvider tripId={tripA} trips={{ get: get as never }}><Probe /></TripProvider>);
    expect(probe(container)).toBe("|false");
    await act(async () => resolve(detail("Patagonia")));
    expect(probe(container)).toBe("Patagonia|false");
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(tripA);
  });
  it("keeps an empty name when the request fails or throws", async () => {
    const failing = vi.fn().mockResolvedValue({ ok: false, error: { kind: "network" } });
    const first = await render(<TripProvider tripId={tripA} trips={{ get: failing }}><Probe /></TripProvider>);
    expect(probe(first.container)).toBe("|false");
    const throwing = vi.fn().mockRejectedValue(new Error("x"));
    const second = await render(<TripProvider tripId={tripA} trips={{ get: throwing }}><Probe /></TripProvider>);
    expect(probe(second.container)).toBe("|false");
  });
  it("does not ask for a Trip without api and the shell frame flags the shell", async () => {
    const { container } = await render(<TripProvider tripId={tripA}><ShellFrame><Probe /></ShellFrame></TripProvider>);
    expect(probe(container)).toBe("|true");
  });
  it("another Trip does not inherit the previous name (state is dropped, not reused)", async () => {
    const get = vi.fn((id: string) => Promise.resolve(id === tripA ? detail("Patagonia") : { ok: true as const, value: { id, kind: "member" as const, name: "Lisboa" } }));
    const view = await render(<TripProvider key={tripA} tripId={tripA} trips={{ get: get as never }}><Probe /></TripProvider>);
    expect(probe(view.container)).toBe("Patagonia|false");
    let resolveB!: (value: unknown) => void;
    get.mockImplementationOnce(() => new Promise((r) => { resolveB = r; }) as never);
    await view.rerender(<TripProvider key={tripB} tripId={tripB} trips={{ get: get as never }}><Probe /></TripProvider>);
    expect(probe(view.container)).toBe("|false");
    await act(async () => resolveB({ ok: true, value: { id: tripB, kind: "member", name: "Lisboa" } }));
    expect(probe(view.container)).toBe("Lisboa|false");
  });
  it("outside a provider the name is empty and it is not in the shell", async () => {
    const { container } = await render(<Probe />);
    expect(probe(container)).toBe("|false");
  });
});
