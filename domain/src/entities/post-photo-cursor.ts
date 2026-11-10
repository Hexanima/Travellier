import { ValidationError } from "../errors/validation-error.js";
import { err, ok, type Result } from "../types/result.js";
import { createObjectId, type ObjectId } from "../value-objects/object-id.js";

/** Which photos a page lists: all of the Trip, or those whose effective activity / transport is the given id. */
export type PhotoFilter = "all" | `a:${string}` | `t:${string}`;
/** Position of a photo in the total order: publication of its post (desc), post id (desc), photo order (asc). */
export interface PhotoPosition { createdAtMs: number; postId: ObjectId; order: number }

const CURSOR_VERSION = 1;
const MAX_CURSOR_LENGTH = 512;
const invalid = () => err(new ValidationError([{ field: "cursor", code: "invalid", message: "Cursor is not valid for this request." }]));

const toBase64Url = (text: string) => btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (text: string): string | undefined => {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return undefined;
  try { return atob(text.replace(/-/g, "+").replace(/_/g, "/")); } catch { return undefined; }
};
const idOf = (value: unknown): ObjectId | undefined => {
  if (typeof value !== "string") return undefined;
  const parsed = createObjectId(value);
  return parsed.ok ? parsed.value : undefined;
};
const validFilter = (value: unknown): value is PhotoFilter =>
  value === "all" || (typeof value === "string" && /^[at]:/.test(value) && idOf(value.slice(2)) !== undefined);

/** Opaque, unsigned token: only a position inside data the caller can already read; authorization is re-evaluated on every request. */
export const encodePhotoCursor = (input: { tripId: ObjectId; filter: PhotoFilter; position: PhotoPosition }): string =>
  toBase64Url(JSON.stringify({ v: CURSOR_VERSION, t: input.tripId, f: input.filter, c: input.position.createdAtMs,
    p: input.position.postId, o: input.position.order }));

/** Strict parse; the cursor must belong to this Trip and filter, otherwise it is invalid (also when forged or truncated). */
export const parsePhotoCursor = (raw: unknown, scope: { tripId: ObjectId; filter: PhotoFilter }): Result<PhotoPosition, ValidationError> => {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_CURSOR_LENGTH) return invalid();
  const text = fromBase64Url(raw);
  if (text === undefined) return invalid();
  let json: unknown;
  try { json = JSON.parse(text); } catch { return invalid(); }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return invalid();
  const { v, t, f, c, p, o } = json as Record<string, unknown>;
  const postId = idOf(p);
  if (v !== CURSOR_VERSION || idOf(t) !== scope.tripId || !validFilter(f) || f !== scope.filter) return invalid();
  if (postId === undefined || !Number.isSafeInteger(c) || !Number.isSafeInteger(o) || (o as number) < 0) return invalid();
  return ok({ createdAtMs: c as number, postId, order: o as number });
};

const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Sort comparator: negative when `a` is listed before `b`. */
export const comparePhotoPosition = (a: PhotoPosition, b: PhotoPosition): number =>
  b.createdAtMs - a.createdAtMs || compareText(b.postId, a.postId) || a.order - b.order;
