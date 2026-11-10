import { randomUUID } from "node:crypto";

import type { Db } from "mongodb";
import { dispatchPushNotifications, PUSH_DISPATCH_BATCH_SIZE, type PushDispatchRunSummary, type PushProviderPort, type Result } from "app-domain";
import { readEventsRuntimeConfig } from "./adapters/aws/events-config.js";
import type { SecretValueReader } from "./adapters/aws/runtime-config.js";
import { createSnsPushProvider, type SnsPushClient } from "./adapters/aws/sns-push-provider.js";
import { connectMongoDatabase } from "./adapters/mongodb/connection.js";
import { createMongoPushDeviceRepository } from "./adapters/mongodb/push-device-repository.js";
import { createMongoDispatchAudience, createMongoPushDispatchRepository } from "./adapters/mongodb/push-dispatch-repository.js";
import { isTick, parseBody, type SqsBatchResponse, type SqsEvent } from "./sqs-tick.js";

/**
 * Push dispatch worker (T92). READY BUT NOT WIRED: serverless.yml has no function, role or rule for it, and the production composition that
 * builds the real SNS client with the AWS SDK is NOT written (`createSnsClient` is injected; `@aws-sdk/client-sns` is not a dependency yet).
 */
export const EVENTS_DEADLINE_MS = 45_000;

export interface EventsHandlerDependencies {
  /** Stage of this deployment (`APP_ENV`); a tick for another stage is a failure of the item. */
  expectedStage: string;
  run: (input: { deadline: Date }) => Promise<Result<PushDispatchRunSummary>>;
  now: () => Date;
  deadlineMs: number;
  /** Receives counters only: never tokens, ARNs, user ids or raw errors. */
  log: (entry: Record<string, unknown>) => void;
}

/** SQS consumer (batch of 1, `ReportBatchItemFailures`): an invalid tick or an infrastructure failure fails the item; per-event failures keep their own retry state. */
export const createEventsHandler = (deps: EventsHandlerDependencies) =>
  async (event: SqsEvent): Promise<SqsBatchResponse> => {
    const batchItemFailures: { itemIdentifier: string }[] = [];
    for (const record of event.Records) {
      if (!isTick(parseBody(record.body), "events", deps.expectedStage)) {
        batchItemFailures.push({ itemIdentifier: record.messageId });
        continue;
      }
      try {
        const result = await deps.run({ deadline: new Date(deps.now().getTime() + deps.deadlineMs) });
        if (!result.ok || result.value.claimFailed) {
          deps.log({ event: "events", outcome: "failed" });
          batchItemFailures.push({ itemIdentifier: record.messageId });
        } else {
          deps.log({ event: "events", ...result.value });
        }
      } catch {
        deps.log({ event: "events", outcome: "failed" });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };

export interface EventsRunDependencies {
  loadRuntime: () => Promise<{ database: Db; provider: PushProviderPort }>;
  now: () => Date;
  createOwner?: () => string;
}

/** One tick: dispatches up to `PUSH_DISPATCH_BATCH_SIZE` events before the deadline. */
export const createEventsRun = (deps: EventsRunDependencies) =>
  async ({ deadline }: { deadline: Date }): Promise<Result<PushDispatchRunSummary>> => {
    const { database, provider } = await deps.loadRuntime();
    const devices = createMongoPushDeviceRepository(database);
    return dispatchPushNotifications({ dispatch: createMongoPushDispatchRepository(database), audience: createMongoDispatchAudience(database), devices, provider,
      removeInvalid: devices, now: deps.now, createOwner: deps.createOwner ?? randomUUID, deadline, maxEvents: PUSH_DISPATCH_BATCH_SIZE });
  };

/**
 * Cold-start composition: reads the configuration, connects to MongoDB and builds the SNS provider around the injected client.
 * A failed cold start is retried by the next invocation.
 */
export const createEventsRuntimeLoader = (input: { environment: Record<string, string | undefined>; secretValueReader: SecretValueReader;
  createSnsClient: () => SnsPushClient }) => {
  let runtime: Promise<{ database: Db; provider: PushProviderPort }> | undefined;
  return () => {
    runtime ??= (async () => {
      const config = await readEventsRuntimeConfig(input.environment, input.secretValueReader);
      const { database } = await connectMongoDatabase(config.mongo);
      return { database, provider: createSnsPushProvider({ client: input.createSnsClient(), applications: config.pushApplications }) };
    })();
    runtime.catch(() => { runtime = undefined; });
    return runtime;
  };
};
