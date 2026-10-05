import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityStatus, ActivityVoteValue } from "app-domain";
import type { TripFailure } from "./trip-management-api.js";
import type { ActivityVoteResponse, TripVoteApi, VoteResponse } from "./trip-vote-api.js";

export type VoteState = { kind: "loading" } | { kind: "error"; error: TripFailure } | {
  kind: "ready"; vote: VoteResponse | null; saving?: ActivityVoteValue;
  error?: TripFailure; failedValue?: ActivityVoteValue; saved?: boolean;
};
type States = Record<string, VoteState>;
type Options = {
  tripId?: string; enabled: boolean; activities: readonly { id: string; status: ActivityStatus }[]; api?: TripVoteApi;
  onStatus: (activityId: string, status: ActivityStatus) => void; onDisabled: () => void;
};
const unavailable = (error?: TripFailure) => error && ["not-found", "forbidden", "unauthorized", "voting-closed", "voting-disabled"].includes(error.kind);

/** One own vote per activity, shared by agenda and detail. Server responses own the global status. */
export function useActivityVotes({ tripId, enabled, activities, api, onStatus, onDisabled }: Options) {
  const [states, setStates] = useState<States>({});
  const current = useRef<States>({});
  const generation = useRef(0);
  const latest = useRef({ activities, onStatus, onDisabled, enabled });
  latest.current = { activities, onStatus, onDisabled, enabled };
  const publish = useCallback((id: string, state: VoteState) => {
    current.current = { ...current.current, [id]: state }; setStates(current.current);
  }, []);
  useEffect(() => {
    generation.current += 1; current.current = {}; setStates({});
    return () => { generation.current += 1; };
  }, [tripId, api, enabled]);
  const active = useCallback((id: string, revision: number) => generation.current === revision &&
    latest.current.enabled && latest.current.activities.some((a) => a.id === id), []);
  const success = useCallback((id: string, value: ActivityVoteResponse, saved = false) => {
    latest.current.onStatus(id, value.activityStatus);
    publish(id, { kind: "ready", vote: value.vote, saved });
  }, [publish]);
  const load = useCallback(async (activityId: string) => {
    if (!api || !tripId || !latest.current.enabled || current.current[activityId]?.kind === "loading") return;
    const revision = generation.current;
    publish(activityId, { kind: "loading" });
    try {
      const result = await api.get(tripId, activityId);
      if (!active(activityId, revision)) return;
      if (result.ok) success(activityId, result.value);
      else publish(activityId, { kind: "error", error: result.error });
    } catch {
      if (active(activityId, revision)) publish(activityId, { kind: "error", error: { kind: "network" } });
    }
  }, [api, tripId, publish, active, success]);
  useEffect(() => {
    if (enabled) for (const activity of activities) if (!current.current[activity.id]) void load(activity.id);
  }, [activities, enabled, load]);
  const change = useCallback(async (activityId: string, value: ActivityVoteValue) => {
    const previous = current.current[activityId];
    const activity = latest.current.activities.find((a) => a.id === activityId);
    if (!api || !tripId || !latest.current.enabled || !activity || activity.status === "confirmed" ||
      previous?.kind !== "ready" || previous.saving || previous.vote?.value === value || unavailable(previous.error)) return;
    const revision = generation.current;
    publish(activityId, { kind: "ready", vote: previous.vote, saving: value });
    const fail = (error: TripFailure) => {
      if (!active(activityId, revision)) return;
      publish(activityId, { kind: "ready", vote: previous.vote, error, failedValue: value });
      if (error.kind === "voting-closed") latest.current.onStatus(activityId, "confirmed");
      if (error.kind === "voting-disabled") {
        // Invalidate all pending votes immediately, before the configuration refresh can finish.
        generation.current += 1; latest.current.onDisabled();
      }
    };
    try {
      const result = await api.set(tripId, activityId, value);
      if (!active(activityId, revision)) return;
      if (result.ok) success(activityId, result.value, true);
      else fail(result.error);
    } catch { fail({ kind: "network" }); }
  }, [api, tripId, publish, active, success]);
  const retry = useCallback((activityId: string) => {
    const state = current.current[activityId];
    if (state?.kind === "error" && !unavailable(state.error) && state.error.kind !== "validation") void load(activityId);
    else if (state?.kind === "ready" && state.failedValue && !unavailable(state.error) && state.error?.kind !== "validation")
      void change(activityId, state.failedValue);
  }, [load, change]);
  return { states, change, retry };
}
