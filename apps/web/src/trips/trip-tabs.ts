export type TripTab = "itinerary" | "diary" | "group";
export type DiaryPanel = "posts" | "photos";
export type RootTab = { tab: "itinerary" } | { tab: "group" } | { tab: "diary"; panel: DiaryPanel };

const roots: Record<string, RootTab> = {
  itinerary: { tab: "itinerary" },
  members: { tab: "group" },
  memories: { tab: "diary", panel: "posts" },
  "memories/photos": { tab: "diary", panel: "photos" },
};

/** The tab a path is the root of, or null for anything else (details, forms, balance, journey, config, another Trip): those open outside the tabs. */
export const rootTabOf = (pathname: string, tripId: string | undefined): RootTab | null => {
  if (!tripId) return null;
  const prefix = `/trips/${tripId}/`;
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length).replace(/\/+$/, "");
  return Object.hasOwn(roots, rest) ? { ...roots[rest]! } : null;
};

/** Root path of a tab; `panel` only applies to the diary. */
export const tabPath = (tripId: string, tab: TripTab, panel: DiaryPanel = "posts"): string =>
  tab === "itinerary" ? `/trips/${tripId}/itinerary` : tab === "group" ? `/trips/${tripId}/members`
    : panel === "photos" ? `/trips/${tripId}/memories/photos` : `/trips/${tripId}/memories`;
