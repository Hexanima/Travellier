// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { itineraryId } from "../trips/itinerary-test-fixture.js";
import type { TripNotification } from "./trip-notification-api.js";
import { useNotifications, type NotificationsState } from "./use-notifications.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); vi.restoreAllMocks(); });

const notice = (n: number): TripNotification => ({ id: itineraryId(n), type: "post.created", tripId: itineraryId(1), actorId: itineraryId(5), createdAt: "2026-11-10T10:00:00.000Z",
  payload: { postId: itineraryId(100 + n), actorId: itineraryId(5), activityId: null } });
const page = (ns: number[], nextCursor: string | null) => ({ ok: true as const, value: { notifications: ns.map(notice), nextCursor } });
const fail = (kind: string) => ({ ok: false as const, error: { kind } });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

let api: NotificationsState;
function Probe({ list, signal }: { list: ReturnType<typeof vi.fn>; signal?: number }) { api = useNotifications(list as never, { refreshSignal: signal }); return <p>{api.items.length}</p>; }
async function mount(list: ReturnType<typeof vi.fn>, signal?: number) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const render = (value?: number) => act(async () => root.render(<Probe list={list} signal={value} />));
  await render(signal);
  return render;
}
const ids = () => api.items.map((item) => item.id);

describe("useNotifications", () => {
  it("loads the first page keeping the server order", async () => {
    const list = vi.fn().mockResolvedValue(page([3, 2, 1], "c1"));
    await mount(list);
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith({});
    expect(ids()).toEqual([itineraryId(3), itineraryId(2), itineraryId(1)]);
    expect(api.phase).toBe("idle");
    expect(api.hasMore).toBe(true);
  });

  it("an empty inbox is idle without more pages", async () => {
    await mount(vi.fn().mockResolvedValue(page([], null)));
    expect(api.phase).toBe("idle");
    expect(api.items).toEqual([]);
    expect(api.hasMore).toBe(false);
  });

  it("loads more with the cursor, appends and drops ids already shown", async () => {
    const list = vi.fn().mockResolvedValueOnce(page([3, 2], "c1")).mockResolvedValueOnce(page([2, 1], null));
    await mount(list);
    await act(async () => api.loadMore());
    expect(list).toHaveBeenLastCalledWith({ cursor: "c1" });
    expect(ids()).toEqual([itineraryId(3), itineraryId(2), itineraryId(1)]);
    expect(api.hasMore).toBe(false);
  });

  it("does not ask twice for the same cursor while it is loading", async () => {
    const more = deferred<unknown>();
    const list = vi.fn().mockResolvedValueOnce(page([2], "c1")).mockReturnValueOnce(more.promise);
    await mount(list);
    act(() => { api.loadMore(); api.loadMore(); });
    expect(list).toHaveBeenCalledTimes(2);
    expect(api.phase).toBe("more-loading");
    await act(async () => more.resolve(page([1], null)));
    expect(api.phase).toBe("idle");
  });

  it("keeps the loaded items when loading more fails and retries that page", async () => {
    const list = vi.fn().mockResolvedValueOnce(page([2], "c1")).mockResolvedValueOnce(fail("network")).mockResolvedValueOnce(page([1], null));
    await mount(list);
    await act(async () => api.loadMore());
    expect(api.phase).toBe("more-error");
    expect(ids()).toEqual([itineraryId(2)]);
    await act(async () => api.retry());
    expect(list).toHaveBeenLastCalledWith({ cursor: "c1" });
    expect(ids()).toEqual([itineraryId(2), itineraryId(1)]);
  });

  it("drops a late answer for a cursor that is no longer the current one", async () => {
    const more = deferred<unknown>();
    const list = vi.fn().mockResolvedValueOnce(page([2], "c1")).mockReturnValueOnce(more.promise).mockResolvedValueOnce(page([9, 2], "c9"));
    await mount(list);
    act(() => api.loadMore());
    await act(async () => { await api.refresh(); });
    expect(api.hasMore).toBe(true);
    await act(async () => more.resolve(page([1], null)));
    expect(ids()).toEqual([itineraryId(9), itineraryId(2)]);
    expect(api.phase).toBe("idle");
    expect(api.hasMore).toBe(true);
  });

  it("refresh keeps what was loaded, adds the new ones first and keeps the cursor of the loaded pages", async () => {
    const list = vi.fn().mockResolvedValueOnce(page([3, 2], "c1")).mockResolvedValueOnce(page([1], null)).mockResolvedValueOnce(page([4, 3], "cX"));
    await mount(list);
    await act(async () => api.loadMore());
    await act(async () => { await api.refresh(); });
    expect(ids()).toEqual([4, 3, 2, 1].map(itineraryId));
    expect(api.hasMore).toBe(false);
  });

  it("a failed refresh conserves the list and flags it; a good one clears the flag", async () => {
    const list = vi.fn().mockResolvedValueOnce(page([2, 1], null)).mockResolvedValueOnce(fail("server")).mockResolvedValueOnce(page([2, 1], null));
    await mount(list);
    await act(async () => { await api.refresh(); });
    expect(ids()).toEqual([itineraryId(2), itineraryId(1)]);
    expect(api.refreshFailed).toBe(true);
    expect(api.phase).toBe("idle");
    await act(async () => { await api.refresh(); });
    expect(api.refreshFailed).toBe(false);
  });

  it("el fallo del refresco conserva su code para que la pantalla distinga el timeout (T150)", async () => {
    const list = vi.fn().mockResolvedValueOnce(page([2, 1], null))
      .mockResolvedValueOnce({ ok: false, error: { kind: "network", code: "TimeoutError" } })
      .mockResolvedValueOnce(page([2, 1], null));
    await mount(list);
    await act(async () => { await api.refresh(); });
    expect(api.refreshError).toEqual({ kind: "network", code: "TimeoutError" });
    await act(async () => { await api.refresh(); });
    expect(api.refreshError).toBeUndefined();
  });

  it("never runs two refreshes at once", async () => {
    const slow = deferred<unknown>();
    const list = vi.fn().mockResolvedValueOnce(page([1], null)).mockReturnValueOnce(slow.promise);
    await mount(list);
    act(() => { void api.refresh(); void api.refresh(); });
    expect(list).toHaveBeenCalledTimes(2);
    await act(async () => slow.resolve(page([1], null)));
  });

  it("an initial failure shows the error and retry loads again; a throwing request is a network failure", async () => {
    const list = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(page([1], null));
    await mount(list);
    expect(api.phase).toBe("error");
    expect(api.error).toEqual({ kind: "network" });
    await act(async () => api.retry());
    expect(api.phase).toBe("idle");
    expect(ids()).toEqual([itineraryId(1)]);
  });

  it("an expired session clears the list and is reported in any phase", async () => {
    const list = vi.fn().mockResolvedValueOnce(page([1], "c1")).mockResolvedValueOnce(fail("unauthorized"));
    await mount(list);
    await act(async () => api.loadMore());
    expect(api.phase).toBe("unauthorized");
    expect(api.items).toEqual([]);
    const refreshed = vi.fn().mockResolvedValueOnce(page([1], null)).mockResolvedValueOnce(fail("unauthorized"));
    await mount(refreshed);
    await act(async () => { await api.refresh(); });
    expect(api.phase).toBe("unauthorized");
    expect(api.items).toEqual([]);
    await mount(vi.fn().mockResolvedValue(fail("unauthorized")));
    expect(api.phase).toBe("unauthorized");
  });

  it("a signal change refreshes, but the first render does not", async () => {
    const list = vi.fn().mockResolvedValue(page([1], null));
    const render = await mount(list, 0);
    expect(list).toHaveBeenCalledTimes(1);
    await render(1);
    expect(list).toHaveBeenCalledTimes(2);
    await render(1);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("ignores answers that arrive after unmounting", async () => {
    const slow = deferred<unknown>();
    const list = vi.fn().mockReturnValue(slow.promise);
    await mount(list);
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    await act(async () => slow.resolve(page([1], null)));
    expect(api.items).toEqual([]);
  });
});
