import { CreatePlatformEndpointCommand, PublishCommand, SetEndpointAttributesCommand, SNSClient } from "@aws-sdk/client-sns";

import type { SnsPushClient } from "./sns-push-provider.js";

/** Per-call limit of every SNS request. The events worker budget (4 calls per send) is derived from it; see serverless.yml and the contract test. */
export const SNS_REQUEST_TIMEOUT_MS = 3000;
export const SNS_CONNECTION_TIMEOUT_MS = 1000;

/**
 * Real SNS client. `maxAttempts: 1`: `Publish` is not idempotent, so retries are governed by the dispatcher, not by the SDK.
 * No credentials or endpoint are set here: the IAM role of the function provides them and the region comes from the caller (`AWS_REGION`).
 */
export const createSnsRealClient = (region: string): SNSClient =>
  new SNSClient({ region, maxAttempts: 1, requestHandler: { connectionTimeout: SNS_CONNECTION_TIMEOUT_MS, requestTimeout: SNS_REQUEST_TIMEOUT_MS } });

export const createSnsClient = ({ region, sns }: { region: string; sns?: SNSClient }): SnsPushClient => {
  if (sns === undefined && region.trim() === "") throw new Error("SNS region is not configured");
  const client = sns ?? createSnsRealClient(region.trim());
  // The abort signal is a backstop above the handler timeout so a stuck call can never outlive the deadline of the worker.
  const call = async <T>(run: (options: { requestTimeout: number; abortSignal: AbortSignal }) => Promise<T>): Promise<T> => {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, SNS_REQUEST_TIMEOUT_MS + 1000);
    try {
      return await run({ requestTimeout: SNS_REQUEST_TIMEOUT_MS, abortSignal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    createPlatformEndpoint: (input) => call((options) => client.send(new CreatePlatformEndpointCommand(input), options)),
    publish: (input) => call((options) => client.send(new PublishCommand(input), options)),
    setEndpointAttributes: (input) => call((options) => client.send(new SetEndpointAttributesCommand(input), options)),
  };
};
