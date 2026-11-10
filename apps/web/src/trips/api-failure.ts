import type { ApiClientError } from "../api/index.js";
import type { TripResult } from "./trip-management-api.js";

/** Shared by the comment and like adapters: the kind and field errors travel; a 404 for an unknown comment also carries its code so the UI can tell it apart. */
export const interactionFailure = (error: ApiClientError): TripResult<never> => ({ ok: false, error: { kind: error.kind,
  ...(error.kind === "not-found" && error.code === "CommentNotFoundError" ? { code: error.code } : {}),
  ...(error.fields ? { fields: error.fields.map(({ field, code, message }) => ({ field, code, message })) } : {}) } });
export const serverFailure: TripResult<never> = { ok: false, error: { kind: "server" } };
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export const isId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{24}$/.test(value);
export const isTimestamp = (value: unknown): value is string => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
