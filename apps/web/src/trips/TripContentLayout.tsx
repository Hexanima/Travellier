import { useParams } from "react-router-dom";
import type { AppLifecycle } from "../native/app-lifecycle.js";
import { TripProvider } from "./trip-context.js";
import type { TripManagementApi } from "./trip-management-api.js";
import { TripRefreshProvider } from "./trip-refresh.js";
import { TripShell } from "./TripShell.js";
import { CommentDraftsProvider } from "./use-comment-drafts.js";
import { PostDraftsProvider } from "./use-post-drafts.js";
import { GalleryProvider, type GalleryProviderProps } from "./use-gallery.js";

/**
 * Layout (no path) of the Trip screens that share state: the itinerary (activity dialog), `memories/*` and the group. The Trip state (its name), the
 * refresh ticker and the gallery snapshots and the memory/comment drafts live here, keyed by Trip, so they are shared by those routes and dropped (timer stopped, drafts discarded) when leaving the Trip.
 * The shell draws the tabs on the root screens only. Without `gallery` there is no gallery provider; without `trips` the name is never asked.
 */
export function TripContentLayout({ gallery, trips, lifecycle }: { gallery?: GalleryProviderProps; trips?: Pick<TripManagementApi, "get">; lifecycle?: AppLifecycle } = {}) {
  const { tripId } = useParams();
  const shell = <PostDraftsProvider key={tripId}><CommentDraftsProvider key={tripId}><TripShell /></CommentDraftsProvider></PostDraftsProvider>;
  return <TripProvider key={tripId} tripId={tripId} trips={trips}>
    <TripRefreshProvider key={tripId} tripId={tripId} lifecycle={lifecycle}>
      {gallery ? <GalleryProvider key={tripId} {...gallery}>{shell}</GalleryProvider> : shell}
    </TripRefreshProvider>
  </TripProvider>;
}
