import { createHmac } from "node:crypto";
import type { RateLimitPolicy, RateLimitPort } from "app-domain";

export type AuthRateLimitRoute = "register" | "login" | "refresh" | "logout";
export type AuthRateLimitFailMode = "open" | "closed";

/** Provisional thresholds (the PRD does not define them); see docs/REVISION_PENDIENTE.md (T102). */
export interface AuthRateLimitConfig {
  login: { ip: RateLimitPolicy; account: RateLimitPolicy };
  register: { ip: RateLimitPolicy };
  /** Shared by refresh and logout. */
  refresh: { ip: RateLimitPolicy };
  /** What to do when the shared store fails: let the request through (default) or reject it. */
  failMode: AuthRateLimitFailMode;
}

const MINUTE = 60_000;
export const defaultAuthRateLimitConfig: AuthRateLimitConfig = {
  login: { ip: { limit: 30, windowMs: 15 * MINUTE }, account: { limit: 5, windowMs: 15 * MINUTE } },
  register: { ip: { limit: 10, windowMs: 60 * MINUTE } },
  refresh: { ip: { limit: 60, windowMs: 15 * MINUTE } },
  failMode: "open",
};

export interface AuthRateLimitSubject {
  /** Client IP as seen by API Gateway / the socket; never taken from X-Forwarded-For. */
  ip: string | undefined;
  /** Only for login. */
  email?: string;
}

export type AuthRateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export interface AuthRateLimiter {
  /** Counts the attempt and decides. Call before any password hashing or user lookup. */
  check: (route: AuthRateLimitRoute, subject: AuthRateLimitSubject) => Promise<AuthRateLimitDecision>;
  /** A login that succeeded forgets only the IP plus email counter; the IP counter is never reset. */
  succeeded: (route: AuthRateLimitRoute, subject: AuthRateLimitSubject) => Promise<void>;
}

export interface AuthRateLimiterOptions {
  port: RateLimitPort;
  /** Keys the hash of the counters (the JWT secret already loaded); never stored or logged. */
  secret: string;
  config: AuthRateLimitConfig;
  now?: () => Date;
  /** Receives only the error name when the store fails. */
  onError?: (errorName: string) => void;
}

const FAILED_CLOSED_RETRY_SECONDS = 30;

export const createAuthRateLimiter = ({ port, secret, config, now = () => new Date(), onError }: AuthRateLimiterOptions): AuthRateLimiter => {
  if (secret === "") throw new Error("Rate limiter secret is required.");
  const keyOf = (kind: string, value: string): string =>
    createHmac("sha256", secret).update(`rate-limit:v1:${kind}:${value}`).digest("hex").slice(0, 32);
  const ipKey = (ip: string | undefined) => keyOf("ip", ip ?? "unknown");
  const accountKey = (ip: string | undefined, email: string | undefined) =>
    keyOf("account", `${ip ?? "unknown"}|${(email ?? "").trim().toLowerCase()}`);

  const targets = (route: AuthRateLimitRoute, { ip, email }: AuthRateLimitSubject) => {
    if (route === "login") {
      return [
        { bucket: "auth.login.ip", key: ipKey(ip), policy: config.login.ip },
        { bucket: "auth.login.account", key: accountKey(ip, email), policy: config.login.account },
      ];
    }
    return [route === "register"
      ? { bucket: "auth.register.ip", key: ipKey(ip), policy: config.register.ip }
      : { bucket: "auth.refresh.ip", key: ipKey(ip), policy: config.refresh.ip }];
  };

  const storeFailed = (errorName: string): AuthRateLimitDecision => {
    onError?.(errorName);
    return config.failMode === "open" ? { allowed: true } : { allowed: false, retryAfterSeconds: FAILED_CLOSED_RETRY_SECONDS };
  };

  return {
    check: async (route, subject) => {
      const at = now();
      try {
        const results = await Promise.all(targets(route, subject).map(({ bucket, key, policy }) =>
          port.hit({ bucket, key, limit: policy.limit, windowMs: policy.windowMs, now: at })));
        const failure = results.find((result) => !result.ok);
        if (failure !== undefined && !failure.ok) return storeFailed(failure.error.tag);
        const denied = results.flatMap((result) => result.ok && !result.value.allowed ? [result.value.retryAfterSeconds] : []);
        return denied.length === 0 ? { allowed: true } : { allowed: false, retryAfterSeconds: Math.max(...denied) };
      } catch (error) {
        return storeFailed(error instanceof Error ? error.name : "UnknownError");
      }
    },
    succeeded: async (route, subject) => {
      if (route !== "login") return;
      try {
        const result = await port.reset({ bucket: "auth.login.account", key: accountKey(subject.ip, subject.email) });
        if (!result.ok) onError?.(result.error.tag);
      } catch (error) {
        onError?.(error instanceof Error ? error.name : "UnknownError");
      }
    },
  };
};
