import { randomUUID } from "node:crypto";

import type { Db } from "mongodb";
import { dispatchPushNotifications, PUSH_DISPATCH_BATCH_SIZE, type PushDispatchRunSummary, type PushProviderPort, type Result } from "app-domain";
import { readEventsRuntimeConfig } from "./adapters/aws/events-config.js";
import type { SecretValueReader } from "./adapters/aws/runtime-config.js";
import { createSecretsManagerSecretValueReader } from "./adapters/aws/secrets-manager-reader.js";
import { createSnsClient } from "./adapters/aws/sns-client.js";
import { createSnsPushProvider, type SnsPushClient } from "./adapters/aws/sns-push-provider.js";
import { connectMongoDatabase } from "./adapters/mongodb/connection.js";
import { createMongoPushDeviceRepository } from "./adapters/mongodb/push-device-repository.js";
import { createMongoDispatchAudience, createMongoPushDispatchRepository } from "./adapters/mongodb/push-dispatch-repository.js";
import { isTick, parseBody, type SqsBatchResponse, type SqsEvent } from "./sqs-tick.js";

/**
 * Push dispatch worker (T92, wired in T142). The deadline leaves room, inside the 60 s timeout of the function, for up to four SNS calls of
 * `SNS_REQUEST_TIMEOUT_MS` (create endpoint, publish, reactivate, publish) plus the closing writes; serverless.yml and its contract test depend on it.
 */
export const EVENTS_DEADLINE_MS = 40_000;

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
  createSnsClient: (region: string) => SnsPushClient }) => {
  let runtime: Promise<{ database: Db; provider: PushProviderPort }> | undefined;
  return () => {
    runtime ??= (async () => {
      const config = await readEventsRuntimeConfig(input.environment, input.secretValueReader);
      const { database } = await connectMongoDatabase(config.mongo);
      return { database, provider: createSnsPushProvider({ client: input.createSnsClient(input.environment.AWS_REGION?.trim() ?? ""), applications: config.pushApplications }) };
    })();
    runtime.catch(() => { runtime = undefined; });
    return runtime;
  };
};

const now = () => new Date();
const loadRuntime = createEventsRuntimeLoader({ environment: process.env, secretValueReader: createSecretsManagerSecretValueReader(),
  createSnsClient: (region) => createSnsClient({ region }) });

/** Production handler: no network access happens on import; the cold start runs on the first invocation. */
export const handler = createEventsHandler({
  expectedStage: process.env.APP_ENV?.trim() ?? "",
  now,
  deadlineMs: EVENTS_DEADLINE_MS,
  log: (entry) => { console.log(JSON.stringify(entry)); },
  run: createEventsRun({ loadRuntime, now }),
});
