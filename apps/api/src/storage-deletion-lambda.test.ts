import { describe, expect, it, vi } from "vitest";
import { err, ok, UnknownError, type StorageDeletionRunSummary } from "app-domain";

import { createPhotoSweepRunner, createStorageDeletionHandler, type StorageDeletionHandlerDependencies } from "./storage-deletion-lambda.js";

const NOW = new Date("2026-11-10T12:00:00.000Z");
const summary: StorageDeletionRunSummary = { processed: 1, completed: 1, failed: 0, exhausted: 0, resolvedKeys: 2, rejectedKeys: 0, claimFailed: false };
const record = (body: unknown, messageId = "m1") => ({ messageId, body: typeof body === "string" ? body : JSON.stringify(body) });
const tick = { kind: "storageDeletionJobs", stage: "dev" };

const setup = (over: Partial<StorageDeletionHandlerDependencies> = {}) => {
  const run = vi.fn().mockResolvedValue(ok(summary));
  const log = vi.fn();
  const deps: StorageDeletionHandlerDependencies = { expectedStage: "dev", run, now: () => NOW, deadlineMs: 45_000, log, ...over };
  return { handler: createStorageDeletionHandler(deps), run, log };
};

describe("storage deletion Lambda handler", () => {
  it("runs the jobs for a valid tick with the internal deadline and reports no failure", async () => {
    const { handler, run } = setup();
    expect(await handler({ Records: [record(tick)] })).toEqual({ batchItemFailures: [] });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({ deadline: new Date(NOW.getTime() + 45_000) });
  });

  it.each([
    ["another kind", { kind: "events", stage: "dev" }],
    ["another stage", { kind: "storageDeletionJobs", stage: "prod" }],
    ["a missing stage", { kind: "storageDeletionJobs" }],
    ["an extra payload with keys", { kind: "storageDeletionJobs", stage: "dev", objectKeys: ["trips/x"] }],
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
    expect(await handler({ Records: [record({ kind: "storageDeletionJobs", stage: "" })] })).toEqual({ batchItemFailures: [{ itemIdentifier: "m1" }] });
    expect(run).not.toHaveBeenCalled();
  });

  it("fails only the invalid items of a batch", async () => {
    const { handler, run } = setup();
    const result = await handler({ Records: [record(tick, "ok-1"), record("x", "bad"), record(tick, "ok-2")] });
    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "bad" }] });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("reports the item as failed when the run errs, throws or cannot claim, without leaking details", async () => {
    for (const outcome of [() => Promise.resolve(err(new UnknownError("mongodb://user:pass@host"))), () => Promise.reject(new Error("mongodb://user:pass@host")),
      () => Promise.resolve(ok({ ...summary, claimFailed: true }))]) {
      const { handler, log } = setup({ run: vi.fn().mockImplementation(outcome) });
      expect(await handler({ Records: [record(tick)] })).toEqual({ batchItemFailures: [{ itemIdentifier: "m1" }] });
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/mongodb|pass|trips\//);
    }
  });

  it("does not fail the item when some jobs only failed partially (they keep their own retry state)", async () => {
    const { handler } = setup({ run: vi.fn().mockResolvedValue(ok({ ...summary, completed: 0, failed: 1 })) });
    expect(await handler({ Records: [record(tick)] })).toEqual({ batchItemFailures: [] });
  });

  it("logs only counters", async () => {
    const { handler, log } = setup();
    await handler({ Records: [record(tick)] });
    expect(log).toHaveBeenCalledWith({ event: "storageDeletionJobs", ...summary });
  });

  it("handles an empty batch", async () => {
    const { handler, run } = setup();
    expect(await handler({ Records: [] })).toEqual({ batchItemFailures: [] });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("abandoned photo sweep runner", () => {
  const sweepSummary = { pages: 1, scanned: 3, deleted: 1, keptRecent: 1, keptLinked: 0, ignored: 1, listFailed: false, deleteFailed: 0, truncated: false };

  it("runs the sweep for a valid manual input with the internal deadline and reports counters only", async () => {
    const sweep = vi.fn().mockResolvedValue(ok(sweepSummary));
    const runner = createPhotoSweepRunner({ expectedStage: "dev", sweep, now: () => NOW, deadlineMs: 45_000 });
    expect(await runner({ kind: "photoSweep", stage: "dev" })).toEqual({ ok: true, summary: sweepSummary });
    expect(sweep).toHaveBeenCalledWith({ deadline: new Date(NOW.getTime() + 45_000) });
  });

  it.each([{ kind: "storageDeletionJobs", stage: "dev" }, { kind: "photoSweep", stage: "prod" }, { kind: "photoSweep" }, null, "photoSweep", { kind: "photoSweep", stage: "dev", minAgeSeconds: 1 }])(
    "rejects an invalid input %j without sweeping", async (input) => {
      const sweep = vi.fn();
      expect(await createPhotoSweepRunner({ expectedStage: "dev", sweep, now: () => NOW, deadlineMs: 45_000 })(input)).toEqual({ ok: false });
      expect(sweep).not.toHaveBeenCalled();
    });

  it("reports a failure without details when the sweep errs or throws", async () => {
    for (const outcome of [() => Promise.resolve(err(new UnknownError("secret"))), () => Promise.reject(new Error("secret"))]) {
      const runner = createPhotoSweepRunner({ expectedStage: "dev", sweep: vi.fn().mockImplementation(outcome), now: () => NOW, deadlineMs: 45_000 });
      expect(await runner({ kind: "photoSweep", stage: "dev" })).toEqual({ ok: false });
    }
  });
});
