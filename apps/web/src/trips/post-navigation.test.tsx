// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { itineraryId } from "./itinerary-test-fixture.js";
import { openPostFrom } from "./open-post.js";
import { PostLink } from "./post-navigation.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const tripId = itineraryId(1);
const postId = itineraryId(5);
const photo = itineraryId(9);
const here = `/trips/${tripId}/memories`;
const seen: { pathname: string; state: unknown }[] = [];
let go: NavigateFunction = () => undefined;
function Spy() { const location = useLocation(); go = useNavigate(); seen.push({ pathname: location.pathname, state: location.state }); return null; }
const last = () => seen[seen.length - 1]!;
async function mount(node: React.ReactNode, state?: unknown) {
  seen.length = 0;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[{ pathname: here, state }]}><Spy />{node}</MemoryRouter>));
  return container;
}
const click = async (element: Element | null) => act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));

describe("opening a post from a list", () => {
  it("stores the place in the current entry merging the previous state instead of replacing it", async () => {
    const container = await mount(<PostLink tripId={tripId} postId={postId} anchor={`data-memory=${postId}`} label="diario">Abrir</PostLink>, { photo, noBack: true });
    await click(container.querySelector("a"));
    expect(last()).toEqual({ pathname: `${here}/${postId}`, state: { origin: { path: here, label: "diario", anchor: `data-memory=${postId}`, scrollY: 0 } } });
    await act(async () => go(-1));
    expect(last()).toEqual({ pathname: here, state: { photo, noBack: true, restore: { anchor: `data-memory=${postId}`, scrollY: 0 } } });
  });
  it("accepts the photos label and carries viewer and panel from the viewer", async () => {
    const anchor = `data-photo=${photo}`;
    await mount(null, { photo });
    await act(async () => openPostFrom(go, { pathname: `${here}/photos`, search: "", state: { photo } }, { tripId, postId, anchor, label: "fotos", viewer: true, panel: "photos" }));
    expect(last()).toEqual({ pathname: `${here}/${postId}`, state: { origin: { path: `${here}/photos`, label: "fotos", anchor, scrollY: 0, viewer: true } } });
    await act(async () => go(-1));
    expect(last().state).toEqual({ photo, restore: { anchor, scrollY: 0, panel: "photos" } });
  });
  it("keeps the browser behaviour for modified clicks", async () => {
    const container = await mount(<PostLink tripId={tripId} postId={postId} anchor={`data-memory=${postId}`} label="diario">Abrir</PostLink>, { photo });
    document.addEventListener("click", (event) => event.preventDefault(), { once: true }); // jsdom cannot navigate
    await act(async () => container.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ctrlKey: true })));
    expect(last().pathname).toBe(here);
    expect(last().state).toEqual({ photo });
  });
});
