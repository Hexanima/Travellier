/** Where a post detail was opened from and how to restore that place. Everything read from router state is validated: the state is untrusted input. */
export type OriginLabel = "diario" | "itinerario" | "recuerdo";
export type PostOrigin = { path: string; search?: string; anchor?: string; scrollY?: number; label: OriginLabel };
/** `panel` is opaque: later tasks (detail panels, transport detail) store and read their own value. */
export type RestoreState = { anchor: string; scrollY: number; panel?: unknown };

const labels: readonly unknown[] = ["diario", "itinerario", "recuerdo"];
const anchorPattern = /^(data-memory|data-itinerary-post)=[0-9a-f]{24}$/;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const scroll = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

export const memoryAnchor = (postId: string) => `data-memory=${postId}`;
export const itineraryAnchor = (postId: string) => `data-itinerary-post=${postId}`;
/** Only the two known attributes become a selector, so a crafted anchor can neither throw nor select something else. */
export const anchorSelector = (anchor: string): string | undefined => {
  if (!anchorPattern.test(anchor)) return undefined;
  const [attribute, value] = anchor.split("=");
  return `[${attribute}="${value}"]`;
};

export const diaryOrigin = (tripId: string): PostOrigin => ({ path: `/trips/${tripId}/memories`, label: "diario" });
export const originHref = (origin: PostOrigin) => `${origin.path}${origin.search ?? ""}`;
export const originLabel = (label: OriginLabel) => label === "diario" ? "Volver al diario" : label === "itinerario" ? "Volver al itinerario" : "Volver al recuerdo";

export const buildOrigin = (location: { pathname: string; search: string }, label: OriginLabel, anchor?: string, scrollY?: number): PostOrigin => ({
  path: location.pathname, ...(location.search ? { search: location.search } : {}), label,
  ...(anchor !== undefined ? { anchor } : {}), ...(scrollY !== undefined ? { scrollY } : {}),
});

const insideTrip = (path: unknown, tripId: string): path is string => {
  const prefix = `/trips/${tripId}/`;
  return typeof path === "string" && path.length > prefix.length && path.startsWith(prefix) && !path.includes("//") && !path.includes("\\") &&
    !path.includes(":") && !path.split("/").some((part) => part === "." || part === "..") && !/[?#\s]/.test(path);
};
/** A valid origin of this Trip, or the diary. Nothing outside `/trips/<tripId>/` is ever navigated to. */
export const readOrigin = (state: unknown, tripId: string): PostOrigin => {
  const origin = record(state) ? state.origin : undefined;
  if (!record(origin) || !insideTrip(origin.path, tripId) || !labels.includes(origin.label)) return diaryOrigin(tripId);
  const { search, anchor, scrollY } = origin;
  if (search !== undefined && (typeof search !== "string" || (search !== "" && !/^\?[^#\s/\\]*$/.test(search)))) return diaryOrigin(tripId);
  if (anchor !== undefined && (typeof anchor !== "string" || !anchorPattern.test(anchor))) return diaryOrigin(tripId);
  if (scrollY !== undefined && !scroll(scrollY)) return diaryOrigin(tripId);
  return { path: origin.path, ...(search ? { search: search as string } : {}), label: origin.label as OriginLabel,
    ...(anchor !== undefined ? { anchor: anchor as string } : {}), ...(scrollY !== undefined ? { scrollY: scrollY as number } : {}) };
};

export const readRestore = (state: unknown): RestoreState | undefined => {
  const restore = record(state) ? state.restore : undefined;
  if (!record(restore) || typeof restore.anchor !== "string" || !anchorPattern.test(restore.anchor) || !scroll(restore.scrollY)) return undefined;
  return { anchor: restore.anchor, scrollY: restore.scrollY, ...(restore.panel !== undefined ? { panel: restore.panel } : {}) };
};
