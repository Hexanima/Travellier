/** Where a post detail was opened from and how to restore that place. Everything read from router state is validated: the state is untrusted input. */
export type OriginLabel = "diario" | "itinerario" | "recuerdo" | "fotos" | "actividad" | "transporte" | "balance" | "avisos";
/** `viewer`: the detail was opened from the photo viewer, so going back reopens it on the photo of the anchor. */
export type PostOrigin = { path: string; search?: string; anchor?: string; scrollY?: number; label: OriginLabel; viewer?: boolean };
/** `panel` is only the gallery tab (`photos`); any other value is dropped without invalidating the restore. */
export type RestorePanel = "photos";
export type RestoreState = { anchor: string; scrollY: number; panel?: RestorePanel };

const labels: readonly unknown[] = ["diario", "itinerario", "recuerdo", "fotos", "actividad", "transporte", "balance", "avisos"];
const anchorPattern = /^(data-memory|data-itinerary-post|data-photo|data-balance-expense)=[0-9a-f]{24}$/;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const scroll = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

export const memoryAnchor = (postId: string) => `data-memory=${postId}`;
export const itineraryAnchor = (postId: string) => `data-itinerary-post=${postId}`;
export const photoAnchor = (photoId: string) => `data-photo=${photoId}`;
export const balanceAnchor = (expenseId: string) => `data-balance-expense=${expenseId}`;
/** Only the known attributes become a selector, so a crafted anchor can neither throw nor select something else. */
export const anchorSelector = (anchor: string): string | undefined => {
  if (!anchorPattern.test(anchor)) return undefined;
  const [attribute, value] = anchor.split("=");
  return `[${attribute}="${value}"]`;
};

export const diaryOrigin = (tripId: string): PostOrigin => ({ path: `/trips/${tripId}/memories`, label: "diario" });
export const balanceOrigin = (tripId: string): PostOrigin => ({ path: `/trips/${tripId}/balance`, label: "balance" });
export const originHref = (origin: PostOrigin) => `${origin.path}${origin.search ?? ""}`;
export const originLabel = (label: OriginLabel) => label === "diario" ? "Volver al diario" : label === "itinerario" ? "Volver al itinerario" : label === "fotos" ? "Volver a las fotos" : label === "actividad" ? "Volver a la actividad" : label === "transporte" ? "Volver al transporte" : label === "balance" ? "Volver al balance" : label === "avisos" ? "Volver a avisos" : "Volver al recuerdo";

/** The notifications center is the only origin outside a Trip: exactly this path and label, nothing else travels with it. */
export const noticesOrigin: PostOrigin = { path: "/notifications", label: "avisos" };
const isNoticesOrigin = (origin: Record<string, unknown>) => origin.path === noticesOrigin.path && origin.label === noticesOrigin.label &&
  origin.search === undefined && origin.anchor === undefined && origin.scrollY === undefined && origin.viewer === undefined;

export const buildOrigin = (location: { pathname: string; search: string }, label: OriginLabel, anchor?: string, scrollY?: number, viewer?: boolean): PostOrigin => ({
  path: location.pathname, ...(location.search ? { search: location.search } : {}), label,
  ...(anchor !== undefined ? { anchor } : {}), ...(scrollY !== undefined ? { scrollY } : {}), ...(viewer !== undefined ? { viewer } : {}),
});

const insideTrip = (path: unknown, tripId: string): path is string => {
  const prefix = `/trips/${tripId}/`;
  return typeof path === "string" && path.length > prefix.length && path.startsWith(prefix) && !path.includes("//") && !path.includes("\\") &&
    !path.includes(":") && !path.split("/").some((part) => part === "." || part === "..") && !/[?#\s]/.test(path);
};
/** A valid origin of this Trip, or the diary. Nothing outside `/trips/<tripId>/` is ever navigated to. */
export const readOrigin = (state: unknown, tripId: string): PostOrigin => {
  const origin = record(state) ? state.origin : undefined;
  if (record(origin) && isNoticesOrigin(origin)) return { ...noticesOrigin };
  if (!record(origin) || !insideTrip(origin.path, tripId) || !labels.includes(origin.label) || origin.label === "avisos") return diaryOrigin(tripId);
  const { search, anchor, scrollY, viewer } = origin;
  if (search !== undefined && (typeof search !== "string" || (search !== "" && !/^\?[^#\s/\\]*$/.test(search)))) return diaryOrigin(tripId);
  if (anchor !== undefined && (typeof anchor !== "string" || !anchorPattern.test(anchor))) return diaryOrigin(tripId);
  if (scrollY !== undefined && !scroll(scrollY)) return diaryOrigin(tripId);
  return { path: origin.path, ...(search ? { search: search as string } : {}), label: origin.label as OriginLabel,
    ...(anchor !== undefined ? { anchor: anchor as string } : {}), ...(scrollY !== undefined ? { scrollY: scrollY as number } : {}),
    ...(typeof viewer === "boolean" ? { viewer } : {}) };
};

/**
 * Whether there is an app entry behind the current one. `key === "default"` is the initial entry; an entry that replaced the initial one
 * has a fresh key, so it carries `noBack` in its state (set with `withNoBack`). Works the same under BrowserRouter and MemoryRouter.
 */
export const canGoBack = (location: { key: string; state: unknown }): boolean =>
  location.key !== "default" && !(record(location.state) && location.state.noBack === true);
/** State for an entry that replaces the first one: nothing is behind it. */
export const withNoBack = (state?: unknown): Record<string, unknown> => ({ ...(record(state) ? state : {}), noBack: true });

export const readRestore = (state: unknown): RestoreState | undefined => {
  const restore = record(state) ? state.restore : undefined;
  if (!record(restore) || typeof restore.anchor !== "string" || !anchorPattern.test(restore.anchor) || !scroll(restore.scrollY)) return undefined;
  return { anchor: restore.anchor, scrollY: restore.scrollY, ...(restore.panel === "photos" ? { panel: "photos" as const } : {}) };
};
/** The photo open in the viewer, kept in the history state as an id only (never a signed url). */
export const readPhoto = (state: unknown): string | undefined =>
  record(state) && typeof state.photo === "string" && /^[0-9a-f]{24}$/.test(state.photo) ? state.photo : undefined;
