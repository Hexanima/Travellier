import { describe, expect, it, vi } from "vitest";
import { err, ok, UnknownError, type PushDispatchRunSummary } from "app-domain";

import { createEventsHandler, EVENTS_DEADLINE_MS, type EventsHandlerDependencies } from "./events-lambda.js";

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
  it("runs the dispatch for a valid tick with the internal deadline of 45 seconds", async () => {
    const { handler, run } = setup();
    expect(EVENTS_DEADLINE_MS).toBe(45_000);
    expect(await handler({ Records: [record(tick)] })).toEqual({ batchItemFailures: [] });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({ deadline: new Date(NOW.getTime() + 45_000) });
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
