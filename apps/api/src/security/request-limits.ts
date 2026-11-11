import type { ApiResponse } from "../app.js";
import { defaultAuthRateLimitConfig, type AuthRateLimitConfig, type AuthRateLimitFailMode } from "./auth-rate-limit.js";

/** Hard ceiling for any configured body limit: never raise it through the environment. */
export const HARD_MAX_BODY_BYTES = 1_048_576;
export const DEFAULT_MAX_BODY_BYTES = 262_144;
export const DEFAULT_MAX_BODY_BYTES_AUTH = 16_384;
const MIN_BODY_BYTES = 1_024;

export interface SecurityConfig {
  maxBodyBytes: number;
  maxBodyBytesAuth: number;
  rateLimitEnabled: boolean;
  authRateLimit: AuthRateLimitConfig;
}

type Environment = Record<string, string | undefined>;

// Messages name the variable but never echo its value.
const invalid = (name: string): Error => new Error(`Invalid configuration: ${name}`);

const integerSetting = (environment: Environment, name: string, fallback: number, min: number, max: number): number => {
  const raw = environment[name]?.trim();
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d{1,9}$/.test(raw)) throw invalid(name);
  const value = Number(raw);
  if (value < min || value > max) throw invalid(name);
  return value;
};

const booleanSetting = (environment: Environment, name: string, fallback: boolean): boolean => {
  const raw = environment[name]?.trim();
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw invalid(name);
};

const policySetting = (environment: Environment, prefix: string, fallback: { limit: number; windowMs: number }) => ({
  limit: integerSetting(environment, `${prefix}_MAX`, fallback.limit, 1, 10_000),
  windowMs: integerSetting(environment, `${prefix}_WINDOW_SECONDS`, fallback.windowMs / 1000, 1, 86_400) * 1000,
});

/** Reads the protection settings of one stage; invalid or out-of-range values throw at startup. */
export const readSecurityConfig = (environment: Environment): SecurityConfig => {
  const maxBodyBytes = integerSetting(environment, "MAX_BODY_BYTES", DEFAULT_MAX_BODY_BYTES, MIN_BODY_BYTES, HARD_MAX_BODY_BYTES);
  const maxBodyBytesAuth = integerSetting(environment, "MAX_BODY_BYTES_AUTH", Math.min(DEFAULT_MAX_BODY_BYTES_AUTH, maxBodyBytes), MIN_BODY_BYTES, HARD_MAX_BODY_BYTES);
  if (maxBodyBytesAuth > maxBodyBytes) throw invalid("MAX_BODY_BYTES_AUTH");
  const failMode = environment.AUTH_RATE_LIMIT_FAIL_MODE?.trim() || defaultAuthRateLimitConfig.failMode;
  if (failMode !== "open" && failMode !== "closed") throw invalid("AUTH_RATE_LIMIT_FAIL_MODE");
  const defaults = defaultAuthRateLimitConfig;
  return {
    maxBodyBytes,
    maxBodyBytesAuth,
    rateLimitEnabled: booleanSetting(environment, "AUTH_RATE_LIMIT_ENABLED", true),
    authRateLimit: {
      login: {
        ip: policySetting(environment, "AUTH_RATE_LIMIT_LOGIN_IP", defaults.login.ip),
        account: policySetting(environment, "AUTH_RATE_LIMIT_LOGIN_ACCOUNT", defaults.login.account),
      },
      register: { ip: policySetting(environment, "AUTH_RATE_LIMIT_REGISTER_IP", defaults.register.ip) },
      refresh: { ip: policySetting(environment, "AUTH_RATE_LIMIT_REFRESH_IP", defaults.refresh.ip) },
      failMode: failMode as AuthRateLimitFailMode,
    },
  };
};

/**
 * Routes whose legitimate bodies are tiny (credentials, tokens, join code, push device) use the small limit; every other route uses the
 * default, which covers the largest legitimate payloads (composite publication with expense and payments, transports).
 */
const SMALL_BODY_ROUTES = /^\/(auth\/[^/]+|push-devices(\/[^/]+)?|trips\/join)$/;

export const bodyLimitFor = (path: string, config: SecurityConfig): number =>
  SMALL_BODY_ROUTES.test(path.split("?")[0]) ? config.maxBodyBytesAuth : config.maxBodyBytes;

/** True only when the header exists and is not JSON; a missing header keeps the previous behavior. */
export const contentTypeProblem = (contentType: string | undefined): boolean =>
  contentType !== undefined && contentType.split(";")[0].trim().toLowerCase() !== "application/json";

const json = (statusCode: number, code: string, message: string, headers: Record<string, string> = {}): ApiResponse => ({
  statusCode,
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify({ error: { code, message } }),
});

export const payloadTooLargeResponse = (): ApiResponse => json(413, "PayloadTooLarge", "The request body is too large.");

export const unsupportedMediaTypeResponse = (): ApiResponse =>
  json(415, "UnsupportedMediaType", "The request body must be application/json.");

/** Does not reveal which key tripped the limit nor any count. */
export const tooManyRequestsResponse = (retryAfterSeconds: number): ApiResponse =>
  json(429, "TooManyRequests", "Too many attempts. Try again later.", { "retry-after": String(retryAfterSeconds) });
