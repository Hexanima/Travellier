import { describe, expect, it, vi } from "vitest";
import { err, ok, UnknownError, type PushDispatchRunSummary } from "app-domain";

import { connectMongoDatabase } from "./adapters/mongodb/connection.js";
import { createEventsHandler, createEventsRuntimeLoader, EVENTS_DEADLINE_MS, type EventsHandlerDependencies } from "./events-lambda.js";
import * as eventsModule from "./events-lambda.js";

vi.mock("./adapters/mongodb/connection.js", () => ({ connectMongoDatabase: vi.fn(async () => ({ database: {} })) }));

const connectionsAtImport = vi.mocked(connectMongoDatabase).mock.calls.length;

const NOW = new Date("2026-11-10T12:00:00.000Z");
const summary: PushDispatchRunSummary = { claimed: 3, delivered: 2, skipped: { expired: 0, trip_deleted: 0, not_member: 1, rejoined: 0 }, noDevices: 0,
  invalidOnly: 0, invalidTokens: 1, rejected: 0, transient: 0, exhausted: 0, claimFailed: false, leaseLost: 0 };
const record = (body: unknown, messageId = "m1") => ({ messageId, body: typeof body === "string" ? body : JSON.stringify(body) });
const tick = { kind: "events", stage: "dev" };

const setup = (over: Partial<EventsHandlerDependencies> = {}) => {
  const run = vi.fn().mockResolvedValue(ok(summary));
  const log = vi.fn();
  const deps: EventsHandlerDependencies = { expectedStage: "dev", run, now: () => NOW, deadlineMs: EVENTS_DEADLINE_MS, log, ...over };
  return { handler: createEventsHandler(deps), run, log };
};

describe("events Lambda handler", () => {
  it("runs the dispatch for a valid tick with the internal deadline of 35 seconds", async () => {
    const { handler, run } = setup();
    expect(EVENTS_DEADLINE_MS).toBe(35_000);
    expect(await handler({ Records: [record(tick)] })).toEqual({ batchItemFailures: [] });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({ deadline: new Date(NOW.getTime() + 35_000) });
  });

  it.each([
    ["another kind", { kind: "storageDeletionJobs", stage: "dev" }],
    ["another stage", { kind: "events", stage: "prod" }],
    ["a missing stage", { kind: "events" }],
    ["an extra payload", { kind: "events", stage: "dev", userId: "507f1f77bcf86cd799439011" }],
    ["not JSON", "not json"],
    ["a JSON scalar", "7"],
    ["null", "null"],
  ])("rejects %s as a failure of the item without running anything", async (_name, body) => {
    const { handler, run } = setup();
    expect(await handler({ Records: [record(body, "bad-1")] })).toEqual({ batchItemFailures: [{ itemIdentifier: "bad-1" }] });
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects every tick when the stage of the environment is unknown", async () => {
    const { handler, run } = setup({ expectedStage: "" });
    expect(await handler({ Records: [record({ kind: "events", stage: "" })] })).toEqual({ batchItemFailures: [{ itemIdentifier: "m1" }] });
    expect(run).not.toHaveBeenCalled();
  });

  it("fails only the invalid items of a batch", async () => {
    const { handler, run } = setup();
    expect(await handler({ Records: [record(tick, "ok-1"), record("x", "bad"), record(tick, "ok-2")] })).toEqual({ batchItemFailures: [{ itemIdentifier: "bad" }] });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("reports the item as failed when the run errs, throws or cannot claim, without leaking details", async () => {
    for (const outcome of [() => Promise.resolve(err(new UnknownError("mongodb://user:pass@host"))), () => Promise.reject(new Error("arn:aws:sns:secret token-123")),
      () => Promise.resolve(ok({ ...summary, claimFailed: true }))]) {
      const { handler, log } = setup({ run: vi.fn().mockImplementation(outcome) });
      expect(await handler({ Records: [record(tick)] })).toEqual({ batchItemFailures: [{ itemIdentifier: "m1" }] });
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/mongodb|pass|arn:|token/);
    }
  });

  it("does not fail the item when events only failed partially (they keep their own retry state)", async () => {
    const { handler } = setup({ run: vi.fn().mockResolvedValue(ok({ ...summary, transient: 1, exhausted: 1, invalidTokens: 2 })) });
    expect(await handler({ Records: [record(tick)] })).toEqual({ batchItemFailures: [] });
  });

  it("logs only counters", async () => {
    const { handler, log } = setup();
    await handler({ Records: [record(tick)] });
    expect(log).toHaveBeenCalledWith({ event: "events", ...summary });
  });

  it("handles an empty batch", async () => {
    const { handler, run } = setup();
    expect(await handler({ Records: [] })).toEqual({ batchItemFailures: [] });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("events production composition", () => {
  const ANDROID = "arn:aws:sns:us-east-1:123456789012:app/GCM/travellier-dev-android";
  const IOS = "arn:aws:sns:us-east-1:123456789012:app/APNS_SANDBOX/travellier-dev-ios";
  const environment = { APP_ENV: "dev", AWS_REGION: "eu-west-1", MONGODB_SECRET_ARN: "arn:aws:secretsmanager:us-east-1:123456789012:secret:mongo",
    PUSH_APPLICATIONS_SECRET_ARN: "arn:aws:secretsmanager:us-east-1:123456789012:secret:push" };
  const secrets = { getSecretValue: vi.fn(async (arn: string) => (arn === environment.MONGODB_SECRET_ARN
    ? JSON.stringify({ uri: "mongodb+srv://travellier.example/database", databaseName: "travellier_dev" })
    : JSON.stringify({ stage: "dev", android: ANDROID, ios: IOS }))) };

  it("builds the SNS client with the region of AWS_REGION once per cold start", async () => {
    const client = { createPlatformEndpoint: vi.fn(), publish: vi.fn(), setEndpointAttributes: vi.fn() };
    const createSnsClient = vi.fn(() => client);
    const load = createEventsRuntimeLoader({ environment, secretValueReader: secrets, createSnsClient });
    const first = await load();
    await load();
    expect(createSnsClient).toHaveBeenCalledTimes(1);
    expect(createSnsClient).toHaveBeenCalledWith("eu-west-1");
    expect(first.provider).toBeDefined();
  });

  it("fails the cold start without a region and retries on the next invocation", async () => {
    const createSnsClient = vi.fn(() => { throw new Error("SNS region is not configured"); });
    const load = createEventsRuntimeLoader({ environment: { ...environment, AWS_REGION: "" }, secretValueReader: secrets, createSnsClient });
    await expect(load()).rejects.toThrow("SNS region is not configured");
    await expect(load()).rejects.toThrow("SNS region is not configured");
    expect(createSnsClient).toHaveBeenCalledTimes(2);
  });

  it("exports a production handler without connecting to MongoDB on import", () => {
    expect(typeof eventsModule.handler).toBe("function");
    expect(connectionsAtImport).toBe(0);
  });

  it("rejects ticks of another stage when APP_ENV is not set in the production handler", async () => {
    const result = await eventsModule.handler({ Records: [record({ kind: "events", stage: "dev" }, "x")] });
    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "x" }] });
  });
});
