import type { AsyncResult } from "../types/result.js";

/** Shared-state throttle for unauthenticated, abusable operations (T102). `key` must already be opaque (a keyed hash), never an email or IP. */
export interface RateLimitHit {
  /** Operation family, for example `auth.login.ip`. */
  bucket: string;
  /** Opaque identifier inside the bucket. */
  key: string;
  /** Hits allowed inside one window. */
  limit: number;
  windowMs: number;
  now: Date;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Hits counted in the current window, this one included (not exposed to clients). */
  count: number;
  /** Seconds until the current window ends; meaningful when `allowed` is false. */
  retryAfterSeconds: number;
}

export interface RateLimitPolicy {
  limit: number;
  windowMs: number;
}

export interface RateLimitPort {
  /** Counts the attempt atomically (the attempt is counted even when it is rejected) and answers whether it is within the limit. */
  hit: (input: RateLimitHit) => AsyncResult<RateLimitDecision>;
  /** Forgets every window of one `bucket` and `key`. */
  reset: (input: { bucket: string; key: string }) => AsyncResult<void>;
}
