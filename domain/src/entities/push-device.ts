import { ValidationError, type ValidationIssue } from "../errors/validation-error.js";
import { err, ok, type Result } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

export const PUSH_PROVIDERS = ["fcm", "apns"] as const;
export const PUSH_PLATFORMS = ["android", "ios"] as const;

export type PushProvider = (typeof PUSH_PROVIDERS)[number];
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

/** Provisional cap of devices registered per user (T89). */
export const MAX_PUSH_DEVICES_PER_USER = 10;
export const PUSH_TOKEN_MAX_LENGTH = 4096;
/** Tokens shorter than this are hidden entirely in `maskPushToken`. */
const MIN_MASKABLE_TOKEN_LENGTH = 16;

/** Document of `pushDevices`. `token` is the raw provider token: it is never returned by the API nor logged. */
export interface PushDevice {
  id: ObjectId;
  userId: ObjectId;
  provider: PushProvider;
  platform: PushPlatform;
  token: string;
  createdAt: Date;
  updatedAt: Date;
  lastRegisteredAt: Date;
}

export interface PushDeviceInput {
  provider: PushProvider;
  platform: PushPlatform;
  token: string;
}

/** Only valid pairs: Android goes through FCM, iOS through APNs directly. */
const compatible = (provider: PushProvider, platform: PushPlatform): boolean =>
  (provider === "fcm" && platform === "android") || (provider === "apns" && platform === "ios");

const tokenPattern = /^[\x21-\x7E]+$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Picks only provider, platform and token (unknown fields are ignored). Messages never contain the token. */
export const validatePushDeviceInput = (input: unknown): Result<PushDeviceInput, ValidationError> => {
  if (!isRecord(input)) {
    return err(new ValidationError([{ field: "body", code: "invalid", message: "A push device object is required." }]));
  }
  const issues: ValidationIssue[] = [];
  const provider = PUSH_PROVIDERS.find((candidate) => candidate === input.provider);
  const platform = PUSH_PLATFORMS.find((candidate) => candidate === input.platform);
  if (provider === undefined) issues.push({ field: "provider", code: "invalid", message: "Provider must be fcm or apns." });
  if (platform === undefined) issues.push({ field: "platform", code: "invalid", message: "Platform must be android or ios." });
  if (provider !== undefined && platform !== undefined && !compatible(provider, platform)) {
    issues.push({ field: "platform", code: "incompatible", message: "Provider and platform are not compatible: android uses fcm and ios uses apns." });
  }
  const token = typeof input.token === "string" ? input.token.trim() : undefined;
  if (token === undefined || token.length < 1 || token.length > PUSH_TOKEN_MAX_LENGTH || !tokenPattern.test(token)) {
    issues.push({ field: "token", code: "invalid", message: `Token must be 1-${PUSH_TOKEN_MAX_LENGTH} visible ASCII characters without spaces.` });
  }
  if (issues.length > 0 || provider === undefined || platform === undefined || token === undefined) return err(new ValidationError(issues));
  return ok({ provider, platform, token });
};

/** Hint for the user's own device list: only the last four characters; short tokens are fully hidden. */
export const maskPushToken = (token: string): string =>
  token.length < MIN_MASKABLE_TOKEN_LENGTH ? "****" : `****${token.slice(-4)}`;
