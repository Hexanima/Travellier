import { randomUUID } from "node:crypto";

import { processStorageDeletionJobs, sweepAbandonedPhotoUploads, type AbandonedUploadSweepSummary, type Result, type StorageDeletionRunSummary,
  type ValidationError } from "app-domain";
import { createS3ObjectCleanup } from "./adapters/aws/s3-object-storage.js";
import { createSecretsManagerSecretValueReader } from "./adapters/aws/secrets-manager-reader.js";
import { readStorageDeletionRuntimeConfig, type StorageDeletionRuntimeConfig } from "./adapters/aws/storage-deletion-config.js";
import { connectMongoDatabase } from "./adapters/mongodb/connection.js";
import { createMongoPhotoLinkRepository } from "./adapters/mongodb/photo-link-repository.js";
import { createMongoStorageDeletionJobRepository } from "./adapters/mongodb/storage-deletion-job-repository.js";

export interface SqsRecord { messageId: string; body: string }
export interface SqsEvent { Records: SqsRecord[] }
export interface SqsBatchResponse { batchItemFailures: { itemIdentifier: string }[] }

const DEADLINE_MS = 45_000;
const MAX_JOBS_PER_RUN = 5;
const MAX_SWEEP_PAGES = 20;

export interface StorageDeletionHandlerDependencies {
  /** Stage of this deployment (`APP_ENV`); a tick for another stage is a failure of the item. */
  expectedStage: string;
  run: (input: { deadline: Date }) => Promise<Result<StorageDeletionRunSummary>>;
  now: () => Date;
  deadlineMs: number;
  /** Receives counters only: never keys, secrets or raw errors. */
  log: (entry: Record<string, unknown>) => void;
}

/** A tick is exactly `{ kind, stage }`: it carries no keys or business payload, and nothing else is accepted. */
const isTick = (value: unknown, kind: string, expectedStage: string): boolean => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  const { kind: tickKind, stage } = value as { kind?: unknown; stage?: unknown };
  return expectedStage !== "" && entries.length === 2 && tickKind === kind && stage === expectedStage;
};

const parseBody = (body: string): unknown => {
  try { return JSON.parse(body); } catch { return undefined; }
};

/** SQS consumer (batch of 1, `ReportBatchItemFailures`): an invalid tick or an infrastructure failure fails the item; partial job failures keep their own retry state. */
export const createStorageDeletionHandler = (deps: StorageDeletionHandlerDependencies) =>
  async (event: SqsEvent): Promise<SqsBatchResponse> => {
    const batchItemFailures: { itemIdentifier: string }[] = [];
    for (const record of event.Records) {
      if (!isTick(parseBody(record.body), "storageDeletionJobs", deps.expectedStage)) {
        batchItemFailures.push({ itemIdentifier: record.messageId });
        continue;
      }
      try {
        const result = await deps.run({ deadline: new Date(deps.now().getTime() + deps.deadlineMs) });
        if (!result.ok || result.value.claimFailed) {
          deps.log({ event: "storageDeletionJobs", outcome: "failed" });
          batchItemFailures.push({ itemIdentifier: record.messageId });
        } else {
          deps.log({ event: "storageDeletionJobs", ...result.value });
        }
      } catch {
        deps.log({ event: "storageDeletionJobs", outcome: "failed" });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };

export interface PhotoSweepRunnerDependencies {
  expectedStage: string;
  sweep: (input: { deadline: Date }) => Promise<Result<AbandonedUploadSweepSummary, ValidationError>>;
  now: () => Date;
  deadlineMs: number;
}

export type PhotoSweepOutcome = { ok: true; summary: AbandonedUploadSweepSummary } | { ok: false };

/** Manual entry of the abandoned-upload sweep: `{ kind: "photoSweep", stage }`; no schedule is wired to it. */
export const createPhotoSweepRunner = (deps: PhotoSweepRunnerDependencies) =>
  async (input: unknown): Promise<PhotoSweepOutcome> => {
    if (!isTick(input, "photoSweep", deps.expectedStage)) return { ok: false };
    try {
      const result = await deps.sweep({ deadline: new Date(deps.now().getTime() + deps.deadlineMs) });
      return result.ok ? { ok: true, summary: result.value } : { ok: false };
    } catch {
      return { ok: false };
    }
  };

const secretValueReader = createSecretsManagerSecretValueReader();
let runtime: Promise<{ config: StorageDeletionRuntimeConfig; database: Awaited<ReturnType<typeof connectMongoDatabase>>["database"] }> | undefined;

const loadRuntime = () => {
  runtime ??= (async () => {
    const config = await readStorageDeletionRuntimeConfig(process.env, secretValueReader);
    return { config, database: (await connectMongoDatabase(config.mongo)).database };
  })();
  // A failed cold start must be retried by the next invocation.
  runtime.catch(() => { runtime = undefined; });
  return runtime;
};

const expectedStage = process.env.APP_ENV?.trim() ?? "";
const now = () => new Date();

export const handler = createStorageDeletionHandler({
  expectedStage,
  now,
  deadlineMs: DEADLINE_MS,
  log: (entry) => { console.log(JSON.stringify(entry)); },
  run: async ({ deadline }) => {
    const { config, database } = await loadRuntime();
    return processStorageDeletionJobs({ jobs: createMongoStorageDeletionJobRepository(database), links: createMongoPhotoLinkRepository(database),
      storage: createS3ObjectCleanup({ bucketName: config.photoBucketName }), now, createOwner: randomUUID, deadline, maxJobs: MAX_JOBS_PER_RUN });
  },
});

export const runAbandonedPhotoSweep = createPhotoSweepRunner({
  expectedStage,
  now,
  deadlineMs: DEADLINE_MS,
  sweep: async ({ deadline }) => {
    const { config, database } = await loadRuntime();
    return sweepAbandonedPhotoUploads({ links: createMongoPhotoLinkRepository(database), storage: createS3ObjectCleanup({ bucketName: config.photoBucketName }),
      now, deadline, maxPages: MAX_SWEEP_PAGES });
  },
});
