import { Outlet, useParams } from "react-router-dom";
import { GalleryProvider, type GalleryProviderProps } from "./use-gallery.js";

/**
 * Layout (no path) of the routes that show gallery photos: the itinerary (activity dialog) and `memories/*`. The gallery snapshots live here, keyed by Trip,
 * so they are shared by those routes and dropped when leaving the Trip. Without `gallery` there is no provider.
 */
export function TripContentLayout({ gallery }: { gallery?: GalleryProviderProps } = {}) {
  const { tripId } = useParams();
  return gallery ? <GalleryProvider key={tripId} {...gallery}><Outlet /></GalleryProvider> : <Outlet />;
}
