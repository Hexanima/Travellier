import type { ApiClientError, HttpClient } from "../api/index.js";
import { interactionFailure, isRecord, serverFailure } from "./api-failure.js";
import type { TripResult } from "./trip-management-api.js";

export type PhotoFileDescriptor = { contentType: string; sizeBytes: number };
/** A reserved S3 object: the binary is sent with a PUT to `uploadUrl` using exactly `headers`; `expiresAt` is epoch ms. */
export type UploadTarget = { key: string; uploadUrl: string; headers: Record<string, string>; expiresAt: number };
export type TripPhotoApi = {
  /** Reserves one key per file (1 to 10). Unused keys stay orphaned on the server until its sweep removes them. */
  reserve: (tripId: string, files: readonly PhotoFileDescriptor[]) => Promise<TripResult<UploadTarget[]>>;
};

type Raw = { ok: true; value: unknown } | { ok: false; error: ApiClientError };
const httpsUrl = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
};
const stringRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((item) => typeof item === "string");
/** Strict: a target the client cannot use safely (foreign key prefix, plain http, odd headers) is a server failure; nothing is invented. */
const parseTarget = (value: unknown, tripId: string): UploadTarget | undefined => {
  if (!isRecord(value) || typeof value.key !== "string" || !value.key.startsWith(`trips/${tripId}/photos/`) || !httpsUrl(value.uploadUrl) ||
    !stringRecord(value.headers) || typeof value.expiresAt !== "string") return undefined;
  const expiresAt = Date.parse(value.expiresAt);
  return Number.isFinite(expiresAt) ? { key: value.key, uploadUrl: value.uploadUrl, headers: { ...value.headers }, expiresAt } : undefined;
};

export const createTripPhotoApi = (client: Pick<HttpClient, "post">): TripPhotoApi => ({
  reserve: async (tripId, files) => {
    const result: Raw = await client.post<unknown>(`/trips/${encodeURIComponent(tripId)}/photo-uploads`,
      { files: files.map(({ contentType, sizeBytes }) => ({ contentType, sizeBytes })) });
    if (!result.ok) return interactionFailure(result.error);
    if (!isRecord(result.value) || !Array.isArray(result.value.uploads) || result.value.uploads.length !== files.length) return serverFailure;
    const targets = result.value.uploads.map((item) => parseTarget(item, tripId));
    return targets.every((item) => item !== undefined) && new Set(targets.map((item) => item.key)).size === targets.length ? { ok: true, value: targets } : serverFailure;
  },
});
