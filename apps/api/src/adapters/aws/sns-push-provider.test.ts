import { describe, expect, it, vi } from "vitest";
import { buildPushMessage, createObjectId, type ObjectId, type PushableEvent } from "app-domain";

import { createSnsPushProvider, type SnsPushClient } from "./sns-push-provider.js";

const id = (value: string): ObjectId => {
  const result = createObjectId(value);
  if (!result.ok) throw new Error("bad id");
  return result.value;
};
const ANDROID_APP = "arn:aws:sns:us-east-1:000000000000:app/GCM/travellier-test-android";
const IOS_APP = "arn:aws:sns:us-east-1:000000000000:app/APNS_SANDBOX/travellier-test-ios";
const ENDPOINT = "arn:aws:sns:us-east-1:000000000000:endpoint/FAKE/fake/00000000-fake";
const SENTINEL = "SENTINEL-token-0123456789-abcdefXYZ";
const event: PushableEvent = { id: id("607f1f77bcf86cd799439001"), type: "comment.created", tripId: id("507f1f77bcf86cd799439011"),
  payload: { commentId: id("507f1f77bcf86cd799439014"), postId: id("507f1f77bcf86cd799439013"), actorId: id("507f1f77bcf86cd799439015") } };
const message = buildPushMessage(event);
const fcmDevice = { provider: "fcm" as const, platform: "android" as const, token: SENTINEL };
const apnsDevice = { provider: "apns" as const, platform: "ios" as const, token: SENTINEL };

const awsError = (name: string, status?: number, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(`${SENTINEL} ${ENDPOINT} secret detail`), { name, ...(status === undefined ? {} : { $metadata: { httpStatusCode: status } }), ...extra });

const setup = (over: Partial<SnsPushClient> = {}) => {
  const client = {
    createPlatformEndpoint: vi.fn(over.createPlatformEndpoint ?? (async () => ({ EndpointArn: ENDPOINT }))),
    publish: vi.fn(over.publish ?? (async () => ({ MessageId: "fake" }))),
  };
  return { client, provider: createSnsPushProvider({ client, applications: { android: ANDROID_APP, ios: IOS_APP } }) };
};

describe("SNS push provider", () => {
  it("creates the endpoint in the application of the platform and publishes the FCM v1 message", async () => {
    const { client, provider } = setup();
    expect(await provider.send({ device: fcmDevice, message, dedupeId: "e:d" })).toEqual({ ok: true, value: { kind: "delivered" } });
    expect(client.createPlatformEndpoint).toHaveBeenCalledWith({ PlatformApplicationArn: ANDROID_APP, Token: SENTINEL });
    const input = client.publish.mock.calls[0]?.[0];
    expect(input).toMatchObject({ TargetArn: ENDPOINT, MessageStructure: "json" });
    const body = JSON.parse(input?.Message ?? "") as Record<string, string>;
    expect(Object.keys(body).sort()).toEqual(["GCM", "default"]);
    const gcm = JSON.parse(body.GCM ?? "") as { fcmV1Message: { message: { notification: unknown; data: Record<string, string> } } };
    expect(gcm.fcmV1Message.message.notification).toEqual({ title: message.title, body: message.body });
    expect(gcm.fcmV1Message.message.data).toEqual(message.data);
  });

  it("keeps a non-empty fallback text for a message with an empty body", async () => {
    const { client, provider } = setup();
    expect(message.body).toBe("");
    await provider.send({ device: fcmDevice, message, dedupeId: "e:d" });
    await provider.send({ device: apnsDevice, message, dedupeId: "e:d" });
    for (const call of client.publish.mock.calls) {
      const body = JSON.parse(call[0].Message ?? "") as Record<string, string>;
      expect(body.default).toBe(message.title);
      expect(body.default).not.toBe("");
    }
  });

  it("uses the iOS application and an APNS payload carrying the alert and the data", async () => {
    const { client, provider } = setup();
    await provider.send({ device: apnsDevice, message, dedupeId: "e:d" });
    expect(client.createPlatformEndpoint).toHaveBeenCalledWith({ PlatformApplicationArn: IOS_APP, Token: SENTINEL });
    const body = JSON.parse(client.publish.mock.calls[0]?.[0].Message ?? "") as Record<string, string>;
    expect(Object.keys(body).sort()).toEqual(["APNS_SANDBOX", "default"]);
    const apns = JSON.parse(body.APNS_SANDBOX ?? "") as { aps: { alert: unknown }; data: Record<string, string> };
    expect(apns.aps.alert).toEqual({ title: message.title, body: message.body });
    expect(apns.data).toEqual(message.data);
  });

  it("uses the APNS key of a production application", async () => {
    const client = setup().client;
    const provider = createSnsPushProvider({ client, applications: { android: ANDROID_APP, ios: IOS_APP.replace("APNS_SANDBOX", "APNS") } });
    await provider.send({ device: apnsDevice, message, dedupeId: "e:d" });
    const body = JSON.parse(client.publish.mock.calls[0]?.[0].Message ?? "") as Record<string, string>;
    expect(Object.keys(body).sort()).toEqual(["APNS", "default"]);
  });

  it("maps a disabled endpoint to an invalid token", async () => {
    for (const name of ["EndpointDisabledException", "EndpointDisabled"]) {
      const { provider } = setup({ publish: vi.fn(async () => { throw awsError(name, 400); }) });
      expect(await provider.send({ device: fcmDevice, message, dedupeId: "e:d" })).toEqual({ ok: true, value: { kind: "invalid_token" } });
    }
  });

  it.each([
    ["ThrottledException", 429], ["Throttling", 400], ["InternalErrorException", 500], ["InternalError", undefined], ["ServiceUnavailable", 503],
    ["AnythingElse", 502], ["TimeoutError", undefined],
  ])("maps %s to a transient failure", async (name, status) => {
    const { provider } = setup({ publish: vi.fn(async () => { throw awsError(name, status); }) });
    expect(await provider.send({ device: fcmDevice, message, dedupeId: "e:d" })).toMatchObject({ ok: true, value: { kind: "transient" } });
  });

  it("maps network failures to a transient failure", async () => {
    const { provider } = setup({ createPlatformEndpoint: vi.fn(async () => { throw awsError("Error", undefined, { code: "ECONNRESET" }); }) });
    expect(await provider.send({ device: fcmDevice, message, dedupeId: "e:d" })).toMatchObject({ ok: true, value: { kind: "transient" } });
  });

  it.each([["InvalidParameterException", 400], ["InvalidParameter", 400], ["AuthorizationErrorException", 403], ["AuthorizationError", 403]])(
    "maps %s to a permanent rejection so no valid token is removed", async (name, status) => {
      const { provider } = setup({ createPlatformEndpoint: vi.fn(async () => { throw awsError(name, status); }) });
      expect(await provider.send({ device: fcmDevice, message, dedupeId: "e:d" })).toMatchObject({ ok: true, value: { kind: "rejected" } });
    });

  it("treats a missing endpoint ARN as transient and does not publish", async () => {
    const { client, provider } = setup({ createPlatformEndpoint: vi.fn(async () => ({})) });
    expect(await provider.send({ device: fcmDevice, message, dedupeId: "e:d" })).toMatchObject({ ok: true, value: { kind: "transient" } });
    expect(client.publish).not.toHaveBeenCalled();
  });

  it("never leaks the token, the endpoint ARN or the SDK message in a result", async () => {
    for (const name of ["EndpointDisabledException", "ThrottledException", "InvalidParameterException", "Weird"]) {
      const { provider } = setup({ publish: vi.fn(async () => { throw awsError(name, 400); }) });
      const serialized = JSON.stringify(await provider.send({ device: fcmDevice, message, dedupeId: "e:d" }));
      expect(serialized).not.toContain(SENTINEL);
      expect(serialized).not.toContain("arn:aws");
      expect(serialized).not.toContain("secret detail");
    }
  });
});
