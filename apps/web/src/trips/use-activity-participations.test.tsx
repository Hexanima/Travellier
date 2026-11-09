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
});
