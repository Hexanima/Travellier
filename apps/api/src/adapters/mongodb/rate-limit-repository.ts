import type { Db } from "mongodb";
import { err, ok, UnknownError, type AsyncResult, type RateLimitPort } from "app-domain";

/** `rateLimits` document: one fixed window of one (bucket, opaque key). Never holds an email or an IP in clear. */
export interface RateLimitDocument {
  _id: string;
  bucket: string;
  keyHash: string;
  count: number;
  expiresAt: Date;
}

/** Margin after the window ends before the TTL index may remove the document; correctness never depends on the TTL (`_id` includes the window start). */
const EXPIRY_MARGIN_MS = 60_000;
const DUPLICATE_KEY = 11000;

const guard = async <T>(work: () => Promise<T>): AsyncResult<T> => {
  try { return ok(await work()); } catch { return err(new UnknownError("Rate limit operation failed.")); }
};

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === DUPLICATE_KEY;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");

/**
 * Filter for `reset`: every window of one (bucket, key). The anchored, escaped prefix of `_id` (`<bucket>:<keyHash>:<windowStart>`) lets Mongo
 * walk the `_id` index range instead of scanning the collection; the exact fields keep look-alike prefixes out.
 */
export const resetFilter = (bucket: string, key: string) => ({
  _id: { $regex: `^${escapeRegExp(`${bucket}:${key}:`)}` },
  bucket,
  keyHash: key,
});

/** Fixed-window counter shared by every Lambda instance: one atomic upsert + `$inc` per attempt. */
export const createMongoRateLimitRepository = (database: Db): RateLimitPort => ({
  hit: ({ bucket, key, limit, windowMs, now }) => guard(async () => {
    const windowStart = Math.floor(now.getTime() / windowMs) * windowMs;
    const windowEnd = windowStart + windowMs;
    const increment = async (attempt: number): Promise<RateLimitDocument> => {
      try {
        const updated = await database.collection<RateLimitDocument>("rateLimits").findOneAndUpdate(
          { _id: `${bucket}:${key}:${windowStart}` },
          { $inc: { count: 1 }, $setOnInsert: { bucket, keyHash: key, expiresAt: new Date(windowEnd + EXPIRY_MARGIN_MS) } },
          { upsert: true, returnDocument: "after" },
        );
        if (updated === null) throw new Error("rate limit upsert returned no document");
        return updated;
      } catch (error) {
        // Two first hits of a window can race on the insert; the loser retries and increments the existing document.
        if (attempt < 2 && isDuplicateKey(error)) return increment(attempt + 1);
        throw error;
      }
    };
    const { count } = await increment(0);
    return { allowed: count <= limit, count, retryAfterSeconds: Math.max(1, Math.ceil((windowEnd - now.getTime()) / 1000)) };
  }),
  reset: ({ bucket, key }) => guard(async () => {
    await database.collection<RateLimitDocument>("rateLimits").deleteMany(resetFilter(bucket, key));
  }),
});
