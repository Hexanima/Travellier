import { useCallback, useEffect, useRef, useState } from "react";
import type { ParticipationConfirmation } from "./participation-conflict.js";
import type { TripFailure, TripResult } from "./trip-management-api.js";
import type { DecisionRequired, ParticipationResponse, PersonalParticipationStatus, TripParticipationApi } from "./trip-participation-api.js";

export type ParticipationConfirming = { target: PersonalParticipationStatus; confirmation: ParticipationConfirmation; stale?: boolean };
export type ParticipationState = { kind: "loading" } | { kind: "error"; error: TripFailure } | {
  kind: "ready"; status: ParticipationResponse["status"]; decisionRequired?: DecisionRequired;
  saving?: PersonalParticipationStatus; confirming?: ParticipationConfirming;
  error?: TripFailure; failedStatus?: PersonalParticipationStatus; saved?: boolean;
};
type Ready = Extract<ParticipationState, { kind: "ready" }>;
type States = Record<string, ParticipationState>;

const fromResponse = (value: ParticipationResponse | null): Ready => ({ kind: "ready", status: value?.status ?? "pending",
  ...(value?.decisionRequired ? { decisionRequired: value.decisionRequired } : {}) });
/** The previous answer and persisted mark: nothing but a saved answer may change them. */
const base = (state: Ready): Ready => ({ kind: "ready", status: state.status, ...(state.decisionRequired ? { decisionRequired: state.decisionRequired } : {}) });

/** Shared by agenda and detail; participation writes never invalidate the itinerary. */
export function useActivityParticipations(tripId: string | undefined, activityIds: readonly string[], api?: TripParticipationApi) {
  const [states, setStates] = useState<States>({});
  const current = useRef<States>({});
  const generation = useRef(0);
  // Activities deleted in this Trip: a late read or write must not bring their state (or a conflict modal) back.
  const removed = useRef(new Set<string>());
  // Writes per activity: every publication (load, save, apply) bumps it, so a silent read that started before one is known to be older. A removal does not: it is dropped through `removed`.
  const writes = useRef<Record<string, number>>({});
  const bump = (id: string) => { writes.current[id] = (writes.current[id] ?? 0) + 1; };
  const publish = useCallback((id: string, state: ParticipationState) => {
    if (removed.current.has(id)) return;
    bump(id);
    current.current = { ...current.current, [id]: state };
    setStates(current.current);
  }, []);

  useEffect(() => {
    generation.current += 1;
    current.current = {}; removed.current = new Set(); setStates({});
    return () => { generation.current += 1; };
  }, [tripId, api]);

  const load = useCallback(async (activityId: string) => {
    if (!api || !tripId) return;
    const revision = generation.current;
    publish(activityId, { kind: "loading" });
    try {
      const result = await api.get(tripId, activityId);
      if (generation.current === revision) publish(activityId, result.ok ? fromResponse(result.value) : { kind: "error", error: result.error });
    } catch {
      if (generation.current === revision) publish(activityId, { kind: "error", error: { kind: "network" } });
    }
  }, [api, tripId, publish]);

  useEffect(() => {
    for (const activityId of activityIds) if (!current.current[activityId] && !removed.current.has(activityId)) void load(activityId);
  }, [activityIds, load]);

  /**
   * Silent refresh (T121): asks again for the answer and mark of these activities without going through `loading` and without touching one that is saving or
   * waiting for a confirmation (the person is deciding). A failure keeps what is shown; a removed activity never comes back. Resolves `error` if any read failed.
   */
  const reload = useCallback(async (activityIds: readonly string[]): Promise<"ok" | "error"> => {
    if (!api || !tripId) return "ok";
    const revision = generation.current;
    let failed = false;
    await Promise.all(activityIds.map(async (activityId) => {
      const before = current.current[activityId];
      // An activity with no state yet is asked for by the load effect (a second read here would duplicate it).
      if (!before || removed.current.has(activityId) || before.kind === "loading" || (before?.kind === "ready" && (before.saving || before.confirming))) return;
      const started = writes.current[activityId] ?? 0;
      try {
        const result = await api.get(tripId, activityId);
        if (generation.current !== revision || removed.current.has(activityId)) return;
        if (!result.ok) { failed = true; return; }
        // Something local (a save, an applied answer) happened while the read was in flight: the read is older than what is shown.
        if ((writes.current[activityId] ?? 0) !== started) return;
        const now = current.current[activityId];
        if (now?.kind === "loading" || (now?.kind === "ready" && (now.saving || now.confirming))) return;
        const fresh = fromResponse(result.value);
        // Same answer and mark as the server: keep the local feedback (error and retry of a failed save, «guardado»).
        const same = now?.kind === "ready" && now.status === fresh.status && now.decisionRequired?.changedAt === fresh.decisionRequired?.changedAt &&
          now.decisionRequired?.reason === fresh.decisionRequired?.reason;
        if (!same) publish(activityId, fresh);
      } catch { failed = true; }
    }));
    return failed ? "error" : "ok";
  }, [api, tripId, publish]);

  /** Sends one write and publishes its outcome; a failure never touches the answer or the mark. */
  const write = useCallback(async (activityId: string, previous: Ready, target: PersonalParticipationStatus, confirmation?: ParticipationConfirmation) => {
    if (!api || !tripId) return;
    const revision = generation.current;
    publish(activityId, { ...base(previous), ...(confirmation ? { confirming: previous.confirming } : {}), saving: target });
    let result: TripResult<ParticipationResponse>;
    try { result = confirmation ? await api.set(tripId, activityId, target, confirmation) : await api.set(tripId, activityId, target); } catch { result = { ok: false, error: { kind: "network" } }; }
    if (generation.current !== revision) return;
    if (result.ok) {
      publish(activityId, { ...fromResponse(result.value), saved: true });
      // A confirmed write succeeded atomically: the server left «No voy» in exactly the incompatible plans the person confirmed.
      if (confirmation) for (const { activityId: other } of confirmation.confirmedConflicts) if (other !== activityId) publish(other, { kind: "ready", status: "not_going" });
    } else if (result.error.kind === "participation-conflict" && result.error.confirmation) {
      publish(activityId, { ...base(previous), confirming: { target, confirmation: result.error.confirmation, ...(confirmation ? { stale: true } : {}) } });
    } else publish(activityId, { ...base(previous), error: result.error, failedStatus: target });
  }, [api, tripId, publish]);

  const change = useCallback(async (activityId: string, status: PersonalParticipationStatus) => {
    const previous = current.current[activityId];
    if (!api || !tripId || previous?.kind !== "ready" || previous.saving || previous.confirming || previous.status === status ||
      (status !== "going" && status !== "not_going") ||
      (previous.error && ["not-found", "forbidden", "unauthorized"].includes(previous.error.kind))) return;
    await write(activityId, previous, status);
  }, [api, tripId, write]);

  const confirmChange = useCallback(async (activityId: string) => {
    const previous = current.current[activityId];
    if (previous?.kind !== "ready" || previous.saving || !previous.confirming) return;
    await write(activityId, previous, previous.confirming.target, previous.confirming.confirmation);
  }, [write]);

  const cancelConfirmation = useCallback((activityId: string) => {
    const previous = current.current[activityId];
    if (previous?.kind !== "ready" || previous.saving || !previous.confirming) return;
    publish(activityId, base(previous));
  }, [publish]);

  const apply = useCallback((activityId: string, participation: ParticipationResponse) => {
    publish(activityId, fromResponse(participation));
  }, [publish]);

  const retry = useCallback((activityId: string) => {
    const state = current.current[activityId];
    if (state?.kind === "error") void load(activityId);
    else if (state?.kind === "ready" && state.failedStatus) void change(activityId, state.failedStatus);
  }, [load, change]);

  /** The activity no longer exists: forget its state and ignore anything still in flight for it. */
  const remove = useCallback((activityId: string) => {
    removed.current.add(activityId);
    const rest = { ...current.current };
    delete rest[activityId];
    current.current = rest;
    setStates(rest);
  }, []);

  return { states, change, confirmChange, cancelConfirmation, apply, retry, remove, reload };
}
