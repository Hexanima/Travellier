import { ok, type PushMessage, type PushPlatform, type PushProviderPort, type PushSendResult } from "app-domain";

/**
 * Structural subset of the SNS client used by the provider (`CreatePlatformEndpoint`, `Publish` and `SetEndpointAttributes`). It is injected:
 * this module does NOT import `@aws-sdk/*`; the production composition with the real SDK client is `sns-client.ts` (T142).
 */
export interface SnsPushClient {
  createPlatformEndpoint: (input: { PlatformApplicationArn: string; Token: string }) => Promise<{ EndpointArn?: string }>;
  publish: (input: { TargetArn: string; Message: string; MessageStructure: "json" }) => Promise<unknown>;
  setEndpointAttributes: (input: { EndpointArn: string; Attributes: Record<string, string> }) => Promise<unknown>;
}

export interface SnsPushApplications {
  /** ARN of the SNS application with platform GCM (FCM HTTP v1) of the stage. */
  android: string;
  /** ARN of the SNS application with platform APNS or APNS_SANDBOX of the stage. */
  ios: string;
}

/** `app/<PLATFORM>/<name>`: the JSON key of the APNS message must be the platform of the application (APNS or APNS_SANDBOX). */
const apnsKey = (applicationArn: string): "APNS" | "APNS_SANDBOX" => (applicationArn.includes("/APNS_SANDBOX/") ? "APNS_SANDBOX" : "APNS");

/**
 * NOT VERIFIED against real AWS: the exact SNS JSON structure of the messages (FCM v1 under `GCM` -> `fcmV1Message`, APNS payload with `aps`
 * plus custom keys) comes from the public documentation and has never been published to a real endpoint. Review before the first real send.
 * `data` only has strings, as FCM requires.
 */
const buildSnsMessage = (platform: PushPlatform, applicationArn: string, { title, body, data }: PushMessage): string => {
  const alert = { title, body };
  // The body can be empty (T135: it only carries lines without a time zone); the fallback text of SNS never is.
  const fallback = body === "" ? title : body;
  if (platform === "android") {
    return JSON.stringify({ default: fallback, GCM: JSON.stringify({ fcmV1Message: { message: { notification: alert, data } } }) });
  }
  return JSON.stringify({ default: fallback, [apnsKey(applicationArn)]: JSON.stringify({ aps: { alert, sound: "default" }, data }) });
};

const NETWORK_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "EPIPE", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_SOCKET"]);

/**
 * Maps an SDK failure to a result WITHOUT reading its message: it can echo the token or the endpoint ARN. Error names follow the AWS SDK v3
 * conventions (`...Exception` suffix optional) and were NOT verified against real AWS.
 * Only `EndpointDisabled` removes the token. `InvalidParameter` and `AuthorizationError` are rejections that keep the token: they usually
 * mean a bad configuration, and removing tokens for that would delete valid ones.
 */
const classify = (error: unknown): PushSendResult => {
  const { name, code, $metadata } = (typeof error === "object" && error !== null ? error : {}) as { name?: unknown; code?: unknown; $metadata?: { httpStatusCode?: unknown } };
  const kind = (typeof name === "string" ? name : "").replace(/Exception$/, "");
  const errno = typeof code === "string" ? code : "";
  const status = typeof $metadata?.httpStatusCode === "number" ? $metadata.httpStatusCode : 0;
  if (kind === "EndpointDisabled") return { kind: "invalid_token" };
  if (kind === "InvalidParameter" || kind === "InvalidParameterValue") return { kind: "rejected", code: "invalid_parameter" };
  if (kind === "AuthorizationError") return { kind: "rejected", code: "authorization_error" };
  if (/^Throttl/.test(kind) || kind === "TooManyRequests" || status === 429) return { kind: "transient", code: "throttled" };
  if (kind === "InternalError" || kind === "InternalFailure" || kind === "InternalServerError") return { kind: "transient", code: "internal_error" };
  if (kind === "ServiceUnavailable" || status >= 500) return { kind: "transient", code: "unavailable" };
  if (kind === "TimeoutError" || kind === "RequestTimeout" || NETWORK_CODES.has(errno)) return { kind: "transient", code: "network" };
  return { kind: "transient", code: "sns_error" };
};

const isEndpointDisabled = (error: unknown): boolean =>
  typeof error === "object" && error !== null && typeof (error as { name?: unknown }).name === "string" && (error as { name: string }).name.replace(/Exception$/, "") === "EndpointDisabled";

/**
 * Sends through SNS: `CreatePlatformEndpoint` per send (idempotent for the same token, so no endpoint ARN is stored) and `Publish` to it with
 * `MessageStructure: "json"`; a disabled endpoint is reactivated once with `SetEndpointAttributes` (T142). SNS `Publish` to an endpoint has no idempotency key: `dedupeId` is not sent, so a retry after an unknown outcome
 * can duplicate a push (the `notificationId` in `data` lets the client deduplicate). Errors never carry the token, the ARN or the SDK message.
 */
export const createSnsPushProvider = ({ client, applications }: { client: SnsPushClient; applications: SnsPushApplications }): PushProviderPort => ({
  send: async ({ device, message }) => {
    const applicationArn = device.platform === "android" ? applications.android : applications.ios;
    try {
      const endpoint = await client.createPlatformEndpoint({ PlatformApplicationArn: applicationArn, Token: device.token });
      if (endpoint.EndpointArn === undefined || endpoint.EndpointArn === "") return ok({ kind: "transient", code: "missing_endpoint" });
      const publishInput = { TargetArn: endpoint.EndpointArn, Message: buildSnsMessage(device.platform, applicationArn, message), MessageStructure: "json" as const };
      try {
        await client.publish(publishInput);
      } catch (error) {
        if (!isEndpointDisabled(error)) throw error;
        // A disabled endpoint is re-enabled with the current token and the publish is retried ONCE. If it is disabled again, the token is invalid.
        await client.setEndpointAttributes({ EndpointArn: endpoint.EndpointArn, Attributes: { Token: device.token, Enabled: "true" } });
        await client.publish(publishInput);
      }
      return ok({ kind: "delivered" });
    } catch (error) {
      return ok(classify(error));
    }
  },
});
