import { ValidationError } from "../errors/validation-error.js";
import { err, ok, type Result } from "../types/result.js";
import { createObjectId, type ObjectId } from "../value-objects/object-id.js";

/** Position of a notification in the total order: creation (desc), then id (desc). */
export interface NotificationPosition { createdAtMs: number; id: ObjectId }

const CURSOR_VERSION = 1;
const MAX_CURSOR_LENGTH = 512;
const invalid = () => err(new ValidationError([{ field: "cursor", code: "invalid", message: "Cursor is not valid for this request." }]));

const toBase64Url = (text: string) => btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (text: string): string | undefined => {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return undefined;
  try { return atob(text.replace(/-/g, "+").replace(/_/g, "/")); } catch { return undefined; }
};

/** Opaque, unsigned token: only a position inside data the caller can already read; authorization is re-evaluated on every request. */
export const encodeNotificationCursor = (position: NotificationPosition): string =>
  toBase64Url(JSON.stringify({ v: CURSOR_VERSION, c: position.createdAtMs, i: position.id }));

/** Strict parse; a forged, truncated or foreign token is invalid. */
export const parseNotificationCursor = (raw: unknown): Result<NotificationPosition, ValidationError> => {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_CURSOR_LENGTH) return invalid();
  const text = fromBase64Url(raw);
  if (text === undefined) return invalid();
  let json: unknown;
  try { json = JSON.parse(text); } catch { return invalid(); }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return invalid();
  const { v, c, i } = json as Record<string, unknown>;
  const id = typeof i === "string" ? createObjectId(i) : undefined;
  if (v !== CURSOR_VERSION || !Number.isSafeInteger(c) || id === undefined || !id.ok) return invalid();
  return ok({ createdAtMs: c as number, id: id.value });
};

/** Sort comparator: negative when `a` is listed before `b`. */
export const compareNotificationPosition = (a: NotificationPosition, b: NotificationPosition): number =>
  b.createdAtMs - a.createdAtMs || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
