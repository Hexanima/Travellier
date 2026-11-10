import { useMemo } from "react";
import { ContextMemories } from "./ContextMemories.js";
import { activityMemories, type ActivityTab } from "./activity-memories.js";
import type { TripItineraryResponse } from "./trip-itinerary-api.js";
import type { TripMembersApi } from "./trip-members-api.js";

export type ActivityMemoriesProps = {
  tripId: string; activityId: string; activityTitle: string;
  /** The itinerary already loaded: the memories of the activity come from its posts (their `context` is computed by the server). */
  itinerary: Pick<TripItineraryResponse, "posts" | "unplacedPosts">;
  members: Pick<TripMembersApi, "list">; timeZone: string;
  tab: ActivityTab; onTab: (tab: ActivityTab) => void;
  /** The gallery answered 404/403: the activity is no longer reachable. */
  onGone: () => void;
  /** The list (or, with Fotos, the loaded gallery) is on screen: the position of a return can be restored. */
  onSettled: () => void;
};

const texts = { section: "Recuerdos y fotos de la actividad", list: "Recuerdos de la actividad", emptyMemories: "Todavía no hay recuerdos de esta actividad",
  emptyPhotos: "Todavía no hay fotos de esta actividad", photos: "Fotos de la actividad" };

/** Recuerdos and Fotos of one activity: the generic panel filtered by `activityId`. */
export function ActivityMemories({ tripId, activityId, activityTitle, itinerary, members, timeZone, tab, onTab, onGone, onSettled }: ActivityMemoriesProps) {
  const memories = useMemo(() => activityMemories(itinerary.posts, itinerary.unplacedPosts, activityId), [itinerary.posts, itinerary.unplacedPosts, activityId]);
  return <ContextMemories tripId={tripId} filter={{ activityId }} memories={memories} members={members} timeZone={timeZone} tab={tab} onTab={onTab} onGone={onGone}
    onSettled={onSettled} originLabel="actividad" sharePath={`/trips/${tripId}/memories/new?activityId=${activityId}`} shareState={{ activityLabel: activityTitle }}
    idPrefix="activity" texts={texts} />;
}
