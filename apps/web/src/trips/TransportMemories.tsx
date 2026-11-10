import { useMemo } from "react";
import { ContextMemories } from "./ContextMemories.js";
import type { ActivityTab } from "./activity-memories.js";
import { transportMemories } from "./transport-detail.js";
import type { TripItineraryResponse } from "./trip-itinerary-api.js";
import type { TripMembersApi } from "./trip-members-api.js";

export type TransportMemoriesProps = {
  tripId: string; transportId: string;
  /** The itinerary already loaded: the memories of the transport come from its posts (their `context` is computed by the server). */
  itinerary: Pick<TripItineraryResponse, "posts" | "unplacedPosts">;
  members: Pick<TripMembersApi, "list">; timeZone: string;
  tab: ActivityTab; onTab: (tab: ActivityTab) => void;
  /** The gallery answered 404/403: the transport is no longer reachable. */
  onGone: () => void;
  /** The list (or, with Fotos, the loaded gallery) is on screen: the position of a return can be restored. */
  onSettled: () => void;
};

const texts = { section: "Recuerdos y fotos del transporte", list: "Recuerdos del transporte", emptyMemories: "Todavía no hay recuerdos de este transporte",
  emptyPhotos: "Todavía no hay fotos de este transporte", photos: "Fotos del transporte" };

/** Recuerdos and Fotos of one transport: the generic panel filtered by `transportId`. «Compartir» preloads the transport, with no extra link selector. */
export function TransportMemories({ tripId, transportId, itinerary, members, timeZone, tab, onTab, onGone, onSettled }: TransportMemoriesProps) {
  const memories = useMemo(() => transportMemories(itinerary.posts, itinerary.unplacedPosts, transportId), [itinerary.posts, itinerary.unplacedPosts, transportId]);
  return <ContextMemories tripId={tripId} filter={{ transportId }} memories={memories} members={members} timeZone={timeZone} tab={tab} onTab={onTab} onGone={onGone}
    onSettled={onSettled} originLabel="transporte" sharePath={`/trips/${tripId}/memories/new?transportId=${transportId}`} idPrefix="transport" texts={texts} />;
}
