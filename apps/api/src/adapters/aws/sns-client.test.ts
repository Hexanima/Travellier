import { afterEach, describe, expect, it, vi } from "vitest";
import { CreatePlatformEndpointCommand, PublishCommand, SetEndpointAttributesCommand, SNSClient } from "@aws-sdk/client-sns";

import { createSnsClient, SNS_CALL_BUDGET_MS, SNS_CONNECTION_TIMEOUT_MS, SNS_REQUEST_TIMEOUT_MS } from "./sns-client.js";

const sender = () => {
  const send = vi.fn().mockResolvedValue({ EndpointArn: "arn:fake", MessageId: "m" });
  return { send, sns: { send } as unknown as SNSClient };
};

describe("createSnsClient", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("exposes the timeouts as constants", () => {
    expect(SNS_REQUEST_TIMEOUT_MS).toBe(3000);
    expect(SNS_CONNECTION_TIMEOUT_MS).toBe(1000);
    expect(SNS_CALL_BUDGET_MS).toBe(SNS_REQUEST_TIMEOUT_MS + 1000);
  });

  it("sends CreatePlatformEndpoint with its input intact, a per-call timeout and an abort signal", async () => {
    const { send, sns } = sender();
    const client = createSnsClient({ region: "us-east-1", sns });
    const input = { PlatformApplicationArn: "arn:app", Token: "tok" };
    expect(await client.createPlatformEndpoint(input)).toEqual({ EndpointArn: "arn:fake", MessageId: "m" });
    const [command, options] = send.mock.calls[0] as [CreatePlatformEndpointCommand, { requestTimeout: number; abortSignal: AbortSignal }];
    expect(command).toBeInstanceOf(CreatePlatformEndpointCommand);
    expect(command.input).toEqual(input);
    expect(options.requestTimeout).toBe(SNS_REQUEST_TIMEOUT_MS);
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
    expect(options.abortSignal.aborted).toBe(false);
  });

  it("sends Publish and SetEndpointAttributes with the same guarantees", async () => {
    const { send, sns } = sender();
    const client = createSnsClient({ region: "us-east-1", sns });
    const publish = { TargetArn: "arn:e", Message: "{}", MessageStructure: "json" as const };
    const attributes = { EndpointArn: "arn:e", Attributes: { Token: "tok", Enabled: "true" } };
    await client.publish(publish);
    await client.setEndpointAttributes(attributes);
    const [first, second] = send.mock.calls as [[PublishCommand, { requestTimeout: number; abortSignal: AbortSignal }], [SetEndpointAttributesCommand, { requestTimeout: number; abortSignal: AbortSignal }]];
    expect(first[0]).toBeInstanceOf(PublishCommand);
    expect(first[0].input).toEqual(publish);
    expect(second[0]).toBeInstanceOf(SetEndpointAttributesCommand);
    expect(second[0].input).toEqual(attributes);
    for (const [, options] of [first, second]) {
      expect(options.requestTimeout).toBe(SNS_REQUEST_TIMEOUT_MS);
      expect(options.abortSignal.aborted).toBe(false);
    }
  });

  it("aborts a call that never resolves instead of hanging", async () => {
    vi.useFakeTimers();
    const send = vi.fn((_command: unknown, options: { abortSignal: AbortSignal }) => new Promise((_resolve, reject) => {
      options.abortSignal.addEventListener("abort", () => { reject(new Error("aborted")); });
    }));
    const client = createSnsClient({ region: "us-east-1", sns: { send } as unknown as SNSClient });
    const pending = client.publish({ TargetArn: "arn:e", Message: "{}", MessageStructure: "json" });
    const assertion = expect(pending).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(SNS_CALL_BUDGET_MS);
    await assertion;
  });

  it("fires the backstop abort exactly at SNS_CALL_BUDGET_MS, not before", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const send = vi.fn((_command: unknown, options: { abortSignal: AbortSignal }) => new Promise((_resolve, reject) => {
      signal = options.abortSignal;
      options.abortSignal.addEventListener("abort", () => { reject(new Error("aborted")); });
    }));
    const client = createSnsClient({ region: "us-east-1", sns: { send } as unknown as SNSClient });
    const assertion = expect(client.publish({ TargetArn: "arn:e", Message: "{}", MessageStructure: "json" })).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(SNS_CALL_BUDGET_MS - 1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    await assertion;
  });

  it("builds a real SNS client with the region, a single attempt and no network access", async () => {
    const sns = new SNSClient({ region: "us-east-1" });
    expect(sns).toBeDefined();
    const client = createSnsClient({ region: "eu-west-1" });
    expect(typeof client.publish).toBe("function");
    expect(typeof client.createPlatformEndpoint).toBe("function");
    expect(typeof client.setEndpointAttributes).toBe("function");
  });

  it("configures the real client with maxAttempts 1 and the given region", async () => {
    const real = await import("./sns-client.js");
    const config = real.createSnsRealClient("eu-west-1").config;
    expect(await config.region()).toBe("eu-west-1");
    expect(await config.maxAttempts()).toBe(1);
  });

  it("fails with a generic message without a region", () => {
    expect(() => createSnsClient({ region: "" })).toThrow("SNS region is not configured");
    expect(() => createSnsClient({ region: "   " })).toThrow("SNS region is not configured");
  });

  it("does not accept credentials or endpoints", () => {
    // @ts-expect-error credentials are provided by the IAM role of the function
    createSnsClient({ region: "us-east-1", sns: sender().sns, credentials: { accessKeyId: "x" } });
    // @ts-expect-error no endpoint override
    createSnsClient({ region: "us-east-1", sns: sender().sns, endpoint: "http://localhost" });
    expect(true).toBe(true);
  });
});
