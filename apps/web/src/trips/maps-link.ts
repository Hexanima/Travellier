export type MapsCoordinates = { lat: number; lng: number };
export type MapsLink =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "valid"; url: string; host: string; shortener: boolean; place?: string; coordinates?: MapsCoordinates };

const maxLength = 2048;
const maxPlaceLength = 120;
const invalid: MapsLink = { kind: "invalid" };
/** Whitespace and C0/C1 control characters; also catches spaces inside the value. */
const isControl = (text: string, withSpacesAndBackslash: boolean) => Array.from(text).some((char) => {
  const code = char.charCodeAt(0);
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || (withSpacesAndBackslash && (code === 0x20 || char === "\\"));
});
const number = "-?\\d{1,3}(?:\\.\\d{1,15})?";
const pair = new RegExp(`^(${number}),\\s*(${number})$`);
const atPair = new RegExp(`@(${number}),(${number})(?:[,/]|$)`);

const underMaps = (path: string) => path === "/maps" || path.startsWith("/maps/");
/** Exact host allowlist; a host never matches by suffix or substring. Each rule can also restrict the path. */
const hosts: Record<string, { shortener: boolean; path?: (path: string) => boolean }> = {
  "maps.google.com": { shortener: false },
  "www.google.com": { shortener: false, path: underMaps },
  "google.com": { shortener: false, path: underMaps },
  "maps.app.goo.gl": { shortener: true },
  "goo.gl": { shortener: true, path: (path) => path.startsWith("/maps/") && path.length > "/maps/".length },
  "maps.apple.com": { shortener: false },
};

function coordinatesFrom(lat: string | undefined, lng: string | undefined): MapsCoordinates | undefined {
  if (lat === undefined || lng === undefined) return undefined;
  const value = { lat: Number(lat), lng: Number(lng) };
  return Number.isFinite(value.lat) && Number.isFinite(value.lng) && Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180 ? value : undefined;
}
function placeFrom(text: string): string | undefined {
  const value = text.trim();
  return value === "" || value.length > maxPlaceLength || isControl(value, false) ? undefined : value;
}
function decodePathText(segment: string): string | undefined {
  try { return placeFrom(decodeURIComponent(segment.replace(/\+/g, " "))); } catch { return undefined; }
}

/**
 * Validates and reads a maps link without resolving anything: only https links of an exact allowlist are valid, and
 * place/coordinates come only from the url text. Shorteners are valid but open-only. The returned `url` is the normalized href.
 */
export function parseMapsLink(raw: string | null | undefined): MapsLink {
  const value = raw?.trim() ?? "";
  if (value === "") return { kind: "none" };
  if (value.length > maxLength || isControl(value, true) || !/^https:\/\/[^/]/i.test(value)) return invalid;
  let url: URL;
  try { url = new URL(value); } catch { return invalid; }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") return invalid;
  const rule = Object.hasOwn(hosts, url.hostname) ? hosts[url.hostname] : undefined;
  if (!rule || (rule.path && !rule.path(url.pathname))) return invalid;
  const base = { kind: "valid" as const, url: url.href, host: url.hostname, shortener: rule.shortener };
  if (rule.shortener) return base;

  let coordinates: MapsCoordinates | undefined;
  let place: string | undefined;
  const at = atPair.exec(url.pathname);
  if (at) coordinates = coordinatesFrom(at[1], at[2]);
  const params = url.searchParams;
  const ll = pair.exec((params.get("ll") ?? "").trim());
  if (!coordinates && ll) coordinates = coordinatesFrom(ll[1], ll[2]);
  const query = (params.get("q") ?? params.get("query") ?? "").trim();
  if (query !== "") {
    const fromQuery = pair.exec(query);
    if (fromQuery) coordinates ??= coordinatesFrom(fromQuery[1], fromQuery[2]);
    else place = placeFrom(query);
  }
  const inPath = /^\/maps\/place\/([^/]+)/.exec(url.pathname);
  if (inPath?.[1] !== undefined) place = decodePathText(inPath[1]) ?? place;
  return { ...base, ...(place !== undefined ? { place } : {}), ...(coordinates ? { coordinates } : {}) };
}
