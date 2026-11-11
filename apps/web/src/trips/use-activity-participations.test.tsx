// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { itineraryId } from "./itinerary-test-fixture.js";
import type { ParticipationConfirmation } from "./participation-conflict.js";
import type { ParticipationResponse, TripParticipationApi } from "./trip-participation-api.js";
import type { TripResult } from "./trip-management-api.js";
import { useActivityParticipations } from "./use-activity-participations.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });

const A = itineraryId(8);
const mark = { reason: "schedule_conflict", changedFields: ["scheduledAt"], changedAt: "2026-09-26T10:00:00.000Z" } satisfies NonNullable<ParticipationResponse["decisionRequired"]>;
const pending = (decisionRequired: ParticipationResponse["decisionRequired"] = mark): ParticipationResponse => ({ id: itineraryId(50), tripId: itineraryId(1),
  activityId: A, userId: itineraryId(20), status: "pending", updatedAt: "2026-09-25T12:00:00.000Z", decisionRequired });
const answered = (status: ParticipationResponse["status"]): ParticipationResponse => ({ ...pending(null), status });
const confirmation = (n = 9): ParticipationConfirmation => ({ confirmedConflicts: [{ activityId: itineraryId(n), reason: "overlap", scheduledAt: "2026-09-25T12:00:00.000Z", durationMinutes: 60 }],
  confirmedActivity: { scheduledAt: "2026-09-25T12:30:00.000Z", durationMinutes: null } });
const conflict = (n = 9): TripResult<never> => ({ ok: false, error: { kind: "participation-conflict", confirmation: confirmation(n) } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

type Hook = ReturnType<typeof useActivityParticipations>;
async function setup(api: TripParticipationApi, tripId = itineraryId(1)) {
  const ref: { current?: Hook } = {};
  function Harness({ tripId }: { tripId: string }) { ref.current = useActivityParticipations(tripId, [A], api); return null; }
  const root = createRoot(document.body.appendChild(document.createElement("div"))); roots.push(root);
  await act(async () => root.render(<Harness tripId={tripId} />));
  return { hook: () => ref.current!, state: () => ref.current!.states[A] as Extract<Hook["states"][string], { kind: "ready" }>,
    switchTrip: (id: string) => act(async () => root.render(<Harness tripId={id} />)) };
}
const makeApi = (set: TripParticipationApi["set"], initial: ParticipationResponse | null = pending()) => ({ get: vi.fn(async () => ({ ok: true as const, value: initial })), set: vi.fn(set) });

describe("useActivityParticipations conflicts", () => {
  it("loads the persisted mark with the pending status", async () => {
    const { state } = await setup(makeApi(async () => conflict()));
    expect(state().status).toBe("pending"); expect(state().decisionRequired).toEqual(mark);
  });
  it("moves to confirming after a 409 without changing status or mark, with a single set", async () => {
    const api = makeApi(async () => conflict());
    const { hook, state } = await setup(api);
    await act(async () => hook().change(A, "going"));
    expect(api.set).toHaveBeenCalledTimes(1); expect(api.set).toHaveBeenCalledWith(itineraryId(1), A, "going");
    expect(state().confirming).toEqual({ target: "going", confirmation: confirmation() });
    expect(state().status).toBe("pending"); expect(state().decisionRequired).toEqual(mark); expect(state().saving).toBeUndefined();
  });
  it("confirmChange resends exactly the confirmation of the 409 and applying the response clears the mark", async () => {
    const api = makeApi(vi.fn().mockResolvedValueOnce(conflict()).mockResolvedValueOnce({ ok: true, value: answered("going") }));
    const { hook, state } = await setup(api);
    await act(async () => hook().change(A, "going")); await act(async () => hook().confirmChange(A));
    expect(api.set).toHaveBeenCalledTimes(2); expect(api.set).toHaveBeenLastCalledWith(itineraryId(1), A, "going", confirmation());
    expect(state().status).toBe("going"); expect(state().decisionRequired).toBeUndefined(); expect(state().confirming).toBeUndefined();
  });
  it("cancelling sends nothing and keeps status and mark", async () => {
    const api = makeApi(async () => conflict());
    const { hook, state } = await setup(api);
    await act(async () => hook().change(A, "going")); await act(async () => hook().cancelConfirmation(A));
    expect(api.set).toHaveBeenCalledTimes(1); expect(state().confirming).toBeUndefined();
    expect(state().status).toBe("pending"); expect(state().decisionRequired).toEqual(mark); expect(state().error).toBeUndefined();
  });
  it("a second 409 while confirming returns to confirming with the new snapshot flagged stale and no extra write", async () => {
    const api = makeApi(vi.fn().mockResolvedValueOnce(conflict(9)).mockResolvedValueOnce(conflict(10)));
    const { hook, state } = await setup(api);
    await act(async () => hook().change(A, "going")); await act(async () => hook().confirmChange(A));
    expect(api.set).toHaveBeenCalledTimes(2);
    expect(state().confirming).toEqual({ target: "going", confirmation: confirmation(10), stale: true });
    expect(state().decisionRequired).toEqual(mark); expect(state().saving).toBeUndefined();
  });
  it.each([["network"], ["server"]] as const)("a %s failure while confirming keeps status and mark and closes the confirmation", async (kind) => {
    const api = makeApi(vi.fn().mockResolvedValueOnce(conflict()).mockResolvedValueOnce({ ok: false, error: { kind } }));
    const { hook, state } = await setup(api);
    await act(async () => hook().change(A, "going")); await act(async () => hook().confirmChange(A));
    expect(state().confirming).toBeUndefined(); expect(state().error).toEqual({ kind });
    expect(state().failedStatus).toBe("going"); expect(state().status).toBe("pending"); expect(state().decisionRequired).toEqual(mark);
  });
  it("a rejected set while confirming keeps the mark", async () => {
    const api = makeApi(vi.fn().mockResolvedValueOnce(conflict()).mockRejectedValueOnce(new Error("Offline")));
    const { hook, state } = await setup(api);
    await act(async () => hook().change(A, "going")); await act(async () => hook().confirmChange(A));
    expect(state().error).toEqual({ kind: "network" }); expect(state().decisionRequired).toEqual(mark);
  });
  it("a plain failure on the first write keeps the mark and the previous status", async () => {
    const api = makeApi(async () => ({ ok: false, error: { kind: "server" } }));
    const { hook, state } = await setup(api);
    await act(async () => hook().change(A, "not_going"));
    expect(state().decisionRequired).toEqual(mark); expect(state().status).toBe("pending"); expect(state().failedStatus).toBe("not_going");
  });
  it("a direct ok response applies without an extra read and drops the mark", async () => {
    const api = makeApi(async () => ({ ok: true, value: answered("not_going") }));
    const { hook, state } = await setup(api);
    await act(async () => hook().change(A, "not_going"));
    expect(state().status).toBe("not_going"); expect(state().decisionRequired).toBeUndefined(); expect(api.get).toHaveBeenCalledTimes(1);
  });
  it("ignores change while saving or confirming", async () => {
    const write = deferred<TripResult<ParticipationResponse>>();
    const api = makeApi(() => write.promise);
    const { hook } = await setup(api);
    await act(async () => { void hook().change(A, "going"); });
    await act(async () => hook().change(A, "not_going"));
    expect(api.set).toHaveBeenCalledTimes(1);
    await act(async () => write.resolve(conflict()));
    await act(async () => hook().change(A, "not_going"));
    expect(api.set).toHaveBeenCalledTimes(1);
  });
  it("never sends pending", async () => {
    const api = makeApi(async () => ({ ok: true, value: answered("going") }));
    const { hook } = await setup(api);
    await act(async () => hook().change(A, "pending" as never));
    expect(api.set).not.toHaveBeenCalled();
  });
  it("discards an in-flight response after changing Trip, leaving no confirmation behind", async () => {
    const write = deferred<TripResult<ParticipationResponse>>();
    const api = makeApi(() => write.promise);
    const { hook, state, switchTrip } = await setup(api);
    await act(async () => { void hook().change(A, "going"); });
    await switchTrip(itineraryId(99));
    await act(async () => write.resolve(conflict()));
    expect(state().confirming).toBeUndefined(); expect(api.set).toHaveBeenCalledTimes(1);
  });
  it("apply publishes a participation without a read or loading state", async () => {
    const api = makeApi(async () => conflict(), null);
    const { hook, state } = await setup(api);
    await act(async () => hook().apply(A, answered("going")));
    expect(state().status).toBe("going"); expect(api.get).toHaveBeenCalledTimes(1);
  });
  describe("remove", () => {
    const B = itineraryId(9);
    async function setupMany(api: TripParticipationApi, ids: string[] = [A, B]) {
      const ref: { current?: Hook } = {};
      function Harness({ tripId }: { tripId: string }) { ref.current = useActivityParticipations(tripId, ids, api); return null; }
      const root = createRoot(document.body.appendChild(document.createElement("div"))); roots.push(root);
      await act(async () => root.render(<Harness tripId={itineraryId(1)} />));
      return { hook: () => ref.current!, switchTrip: (id: string) => act(async () => root.render(<Harness tripId={id} />)) };
    }
    it("drops only the removed activity's state, without touching others or the API", async () => {
      const api = makeApi(async () => conflict());
      const { hook } = await setupMany(api);
      const other = hook().states[B];
      await act(async () => hook().remove(A));
      expect(hook().states[A]).toBeUndefined();
      expect(hook().states[B]).toBe(other);
      expect(api.set).not.toHaveBeenCalled(); expect(api.get).toHaveBeenCalledTimes(2);
    });
    it("does not reload a removed activity while its id is still requested", async () => {
      const api = makeApi(async () => conflict());
      const { hook } = await setupMany(api);
      await act(async () => hook().remove(A));
      await act(async () => hook().apply(B, answered("going")));
      expect(hook().states[A]).toBeUndefined(); expect(api.get).toHaveBeenCalledTimes(2);
    });
    it("clears an open confirmation", async () => {
      const api = makeApi(async () => conflict());
      const { hook } = await setupMany(api);
      await act(async () => hook().change(A, "going"));
      expect(Object.values(hook().states).some((s) => s.kind === "ready" && s.confirming)).toBe(true);
      await act(async () => hook().remove(A));
      expect(Object.values(hook().states).some((s) => s.kind === "ready" && s.confirming)).toBe(false);
      expect(hook().states[A]).toBeUndefined();
    });
    it("does not republish a write that resolves after removal", async () => {
      const write = deferred<TripResult<ParticipationResponse>>();
      const api = makeApi(() => write.promise);
      const { hook } = await setupMany(api);
      await act(async () => { void hook().change(A, "going"); });
      await act(async () => hook().remove(A));
      await act(async () => write.resolve(conflict()));
      expect(hook().states[A]).toBeUndefined();
      await act(async () => write.resolve({ ok: true, value: answered("going") }));
      expect(hook().states[A]).toBeUndefined();
    });
    it("does not republish a successful write that resolves after removal", async () => {
      const write = deferred<TripResult<ParticipationResponse>>();
      const api = makeApi(() => write.promise);
      const { hook } = await setupMany(api);
      await act(async () => { void hook().change(A, "going"); });
      await act(async () => hook().remove(A));
      await act(async () => write.resolve({ ok: true, value: answered("going") }));
      expect(hook().states[A]).toBeUndefined();
    });
    it("does not republish a read that resolves after removal", async () => {
      const read = deferred<TripResult<ParticipationResponse | null>>();
      const api = { get: vi.fn(() => read.promise), set: vi.fn(async () => conflict()) } as unknown as TripParticipationApi;
      const { hook } = await setupMany(api, [A]);
      await act(async () => hook().remove(A));
      await act(async () => read.resolve({ ok: true, value: pending() }));
      expect(hook().states[A]).toBeUndefined();
    });
    it("forgets removals when the Trip changes, so the same id loads again", async () => {
      const api = makeApi(async () => conflict());
      const { hook, switchTrip } = await setupMany(api, [A]);
      await act(async () => hook().remove(A));
      expect(hook().states[A]).toBeUndefined();
      await switchTrip(itineraryId(99));
      expect(hook().states[A]?.kind).toBe("ready"); expect(api.get).toHaveBeenCalledTimes(2);
    });
  });
});

describe("useActivityParticipations.reload (silent refresh)", () => {
  it("brings the new answer and the new mark without going through loading", async () => {
    let current: ParticipationResponse | null = answered("going");
    const api = { get: vi.fn(async () => ({ ok: true as const, value: current })), set: vi.fn(async () => conflict()) } satisfies TripParticipationApi;
    const { hook, state } = await setup(api);
    expect(state().status).toBe("going");
    current = pending();
    const kinds: string[] = [];
    const get = api.get;
    api.get = vi.fn(async () => { kinds.push(hook().states[A]!.kind); return get(); });
    await act(async () => { await hook().reload([A]); });
    expect(kinds).toEqual(["ready"]);
    expect(state().status).toBe("pending"); expect(state().decisionRequired).toEqual(mark);
  });
  it("does not step over a save or a confirmation in progress", async () => {
    const gate = deferred<TripResult<ParticipationResponse>>();
    const api = makeApi(() => gate.promise, answered("not_going"));
    const { hook, state } = await setup(api);
    await act(async () => { void hook().change(A, "going"); });
    expect(state().saving).toBe("going");
    api.get.mockResolvedValueOnce({ ok: true, value: pending() });
    await act(async () => { await hook().reload([A]); });
    expect(state().saving).toBe("going"); expect(state().status).toBe("not_going");
    await act(async () => gate.resolve({ ok: true, value: answered("going") }));
    expect(state().status).toBe("going");
  });
  it("keeps a confirmation open and its answer", async () => {
    const api = makeApi(async () => conflict(), answered("not_going"));
    const { hook, state } = await setup(api);
    await act(async () => hook().change(A, "going"));
    expect(state().confirming).toBeDefined();
    api.get.mockResolvedValueOnce({ ok: true, value: pending() });
    await act(async () => { await hook().reload([A]); });
    expect(state().confirming).toBeDefined(); expect(state().status).toBe("not_going");
  });
  it("a failed reload keeps what is shown and reports the failure", async () => {
    const api = makeApi(async () => conflict(), answered("going"));
    const { hook, state } = await setup(api);
    api.get.mockResolvedValueOnce({ ok: false, error: { kind: "network" } } as never);
    let outcome: string | undefined;
    await act(async () => { outcome = await hook().reload([A]); });
    expect(outcome).toBe("error"); expect(state().status).toBe("going"); expect(state().error).toBeUndefined();
  });
  it("does not bring back an activity removed meanwhile", async () => {
    const gate = deferred<TripResult<ParticipationResponse | null>>();
    const api = makeApi(async () => conflict(), answered("going"));
    const { hook } = await setup(api);
    api.get.mockReturnValueOnce(gate.promise as never);
    let pendingReload: Promise<unknown> | undefined;
    await act(async () => { pendingReload = hook().reload([A]); });
    await act(async () => hook().remove(A));
    await act(async () => { gate.resolve({ ok: true, value: pending() }); await pendingReload; });
    expect(hook().states[A]).toBeUndefined();
  });
});
