import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityParticipationStatus } from "app-domain";
import type { TripFailure } from "./trip-management-api.js";
import type { TripParticipationApi } from "./trip-participation-api.js";

export type ParticipationState = { kind: "loading" } | { kind: "error"; error: TripFailure } | {
  kind: "ready"; status: ActivityParticipationStatus; saving?: ActivityParticipationStatus;
  error?: TripFailure; failedStatus?: ActivityParticipationStatus; saved?: boolean;
};
type States = Record<string, ParticipationState>;

/** Shared by agenda and detail; participation writes never invalidate the itinerary. */
export function useActivityParticipations(tripId: string | undefined, activityIds: readonly string[], api?: TripParticipationApi) {
  const [states, setStates] = useState<States>({});
  const current = useRef<States>({});
  const generation = useRef(0);
  const publish = useCallback((id: string, state: ParticipationState) => {
    current.current = { ...current.current, [id]: state };
    setStates(current.current);
  }, []);

  useEffect(() => {
    generation.current += 1;
    current.current = {}; setStates({});
    return () => { generation.current += 1; };
  }, [tripId, api]);

  const load = useCallback(async (activityId: string) => {
    if (!api || !tripId) return;
    const revision = generation.current;
    publish(activityId, { kind: "loading" });
    try {
      const result = await api.get(tripId, activityId);
      if (generation.current === revision) publish(activityId, result.ok
        ? { kind: "ready", status: result.value?.status ?? "pending" }
        : { kind: "error", error: result.error });
    } catch {
      if (generation.current === revision) publish(activityId, { kind: "error", error: { kind: "network" } });
    }
  }, [api, tripId, publish]);

  useEffect(() => {
    for (const activityId of activityIds) if (!current.current[activityId]) void load(activityId);
  }, [activityIds, load]);

  const change = useCallback(async (activityId: string, status: ActivityParticipationStatus) => {
    const previous = current.current[activityId];
    if (!api || !tripId || previous?.kind !== "ready" || previous.saving || previous.status === status ||
      (previous.error && ["not-found", "forbidden", "unauthorized"].includes(previous.error.kind))) return;
    const revision = generation.current;
    publish(activityId, { kind: "ready", status: previous.status, saving: status });
    try {
      const result = await api.set(tripId, activityId, status);
      if (generation.current === revision) publish(activityId, result.ok
        ? { kind: "ready", status: result.value.status, saved: true }
        : { kind: "ready", status: previous.status, error: result.error, failedStatus: status });
    } catch {
      if (generation.current === revision) publish(activityId, { kind: "ready", status: previous.status,
        error: { kind: "network" }, failedStatus: status });
    }
  }, [api, tripId, publish]);

  const retry = useCallback((activityId: string) => {
    const state = current.current[activityId];
    if (state?.kind === "error") void load(activityId);
    else if (state?.kind === "ready" && state.failedStatus) void change(activityId, state.failedStatus);
  }, [load, change]);

  return { states, change, retry };
}
