import { describe, expect, it } from "vitest";

import { createPhotoUploadKey } from "../../entities/post-photo.js";
import {
  STORAGE_DELETION_LEASE_SECONDS,
  STORAGE_DELETION_MAX_ATTEMPTS,
  computeRetryDelay,
  type StorageDeletionJobStatus,
} from "../../entities/storage-deletion-job.js";
import { UnknownError } from "../../errors/unknown-error.js";
import type { ObjectStorageCleanupPort } from "../../ports/object-storage-cleanup-port.js";
import type { PhotoLinkPort } from "../../ports/photo-link-port.js";
import type { StorageDeletionJobPort, StorageDeletionJobRelease } from "../../ports/storage-deletion-job-port.js";
import { err, ok } from "../../types/result.js";
import { createObjectId, type ObjectId } from "../../value-objects/object-id.js";
import { processStorageDeletionJobs, type ProcessStorageDeletionJobsDeps } from "./process-storage-deletion-jobs.js";

const id = (value: string): ObjectId => {
  const result = createObjectId(value);
  if (!result.ok) throw new Error("bad id");
  return result.value;
};
const tripA = id("507f1f77bcf86cd799439011"), tripB = id("507f1f77bcf86cd799439012"), user = id("507f1f77bcf86cd799439013");
const jobId = id("507f1f77bcf86cd799439021"), jobId2 = id("507f1f77bcf86cd799439022");
const key = (tripId: ObjectId, n: number): string => createPhotoUploadKey({ tripId, userId: user, extension: "jpg",
  uploadId: `123e4567-e89b-42d3-a456-${String(n).padStart(12, "0")}` });
const T0 = new Date("2026-11-10T12:00:00.000Z");

interface JobRow {
  id: ObjectId; tripId: ObjectId; objectKeys: string[]; resolvedKeys: string[]; rejectedKeys: string[]; attempts: number;
  status: StorageDeletionJobStatus; nextAttemptAt: Date; leaseUntil?: Date; leaseOwner?: string; lastErrorCode?: string; completedAt?: Date;
}
const row = (over: Partial<JobRow> & { objectKeys: string[] }): JobRow => ({ id: jobId, tripId: tripA, resolvedKeys: [], rejectedKeys: [],
  attempts: 0, status: "pending", nextAttemptAt: T0, ...over });

const createJobs = (rows: JobRow[]) => {
  const releases: StorageDeletionJobRelease[] = [];
  const port: StorageDeletionJobPort = {
    claimNext: async ({ now, leaseUntil, owner }) => {
      const found = rows.find((r) => r.status === "pending" && r.nextAttemptAt <= now && (r.leaseUntil === undefined || r.leaseUntil <= now));
      if (!found) return ok(undefined);
      found.leaseUntil = leaseUntil;
      found.leaseOwner = owner;
      return ok({ id: found.id, tripId: found.tripId, objectKeys: [...found.objectKeys], resolvedKeys: [...found.resolvedKeys],
        rejectedKeys: [...found.rejectedKeys], attempts: found.attempts });
    },
    recordResolved: async (jid, owner, { resolved, rejected }) => {
      const found = rows.find((r) => r.id === jid && r.leaseOwner === owner);
      if (!found) return ok(false);
      found.resolvedKeys = [...new Set([...found.resolvedKeys, ...resolved])];
      found.rejectedKeys = [...new Set([...found.rejectedKeys, ...rejected])];
      return ok(true);
    },
    complete: async (jid, owner, now) => {
      const found = rows.find((r) => r.id === jid && r.leaseOwner === owner);
      if (!found) return ok(false);
      found.status = "completed";
      found.completedAt = now;
      found.leaseUntil = undefined;
      found.leaseOwner = undefined;
      return ok(true);
    },
    releaseFailed: async (jid, owner, input) => {
      const found = rows.find((r) => r.id === jid && r.leaseOwner === owner);
      if (!found) return ok(false);
      releases.push(input);
      Object.assign(found, { status: input.status, attempts: input.attempts, nextAttemptAt: input.nextAttemptAt, lastErrorCode: input.lastErrorCode });
      found.leaseUntil = undefined;
      found.leaseOwner = undefined;
      return ok(true);
    },
  };
  return { port, rows, releases };
};

const createStorage = (options: { failOn?: (objectKey: string) => boolean; onDelete?: (objectKey: string) => void } = {}) => {
  const deleted: string[] = [];
  const port: ObjectStorageCleanupPort = {
    deleteObject: async ({ objectKey }) => {
      options.onDelete?.(objectKey);
      if (options.failOn?.(objectKey)) return err(new UnknownError("secret-detail"));
      deleted.push(objectKey);
      return ok(undefined);
    },
    listObjects: async () => ok({ objects: [] }),
  };
  return { port, deleted };
};

const linksOf = (linked: string[] = []): PhotoLinkPort => ({ findLinkedKeys: async (keys) => ok(new Set(keys.filter((k) => linked.includes(k)))) });

const setup = (rows: JobRow[], over: Partial<ProcessStorageDeletionJobsDeps> & { failOn?: (k: string) => boolean; linked?: string[] } = {}) => {
  const jobs = createJobs(rows), storage = createStorage({ failOn: over.failOn });
  let clock = T0, owners = 0;
  const deps: ProcessStorageDeletionJobsDeps = {
    jobs: jobs.port, storage: storage.port, links: linksOf(over.linked), now: () => clock, createOwner: () => `owner-${++owners}`,
    deadline: new Date(T0.getTime() + 45_000), maxJobs: 10, ...over,
  };
  return { deps, jobs, storage, setClock: (date: Date) => { clock = date; } };
};

describe("processStorageDeletionJobs", () => {
  it("deletes only the keys of the job and completes it", async () => {
    const keys = [key(tripA, 1), key(tripA, 2)];
    const ctx = setup([row({ objectKeys: keys })]);
    const result = await processStorageDeletionJobs(ctx.deps);
    expect(result).toEqual({ ok: true, value: { processed: 1, completed: 1, failed: 0, exhausted: 0, resolvedKeys: 2, rejectedKeys: 0, claimFailed: false } });
    expect(ctx.storage.deleted).toEqual(keys);
    expect(ctx.jobs.rows[0]).toMatchObject({ status: "completed", resolvedKeys: keys, completedAt: T0, leaseOwner: undefined });
  });

  it("never deletes keys of another Trip or with path traversal and records them as rejected", async () => {
    const own = key(tripA, 1), foreign = key(tripB, 2);
    const traversal = `trips/${tripA}/photos/${user}/../../${tripB}/photos/${user}/x.jpg`;
    const ctx = setup([row({ objectKeys: [own, foreign, traversal, "avatars/x.jpg"] })]);
    const result = await processStorageDeletionJobs(ctx.deps);
    expect(result).toMatchObject({ ok: true, value: { completed: 1, resolvedKeys: 1, rejectedKeys: 3 } });
    expect(ctx.storage.deleted).toEqual([own]);
    expect(ctx.jobs.rows[0]).toMatchObject({ status: "completed", resolvedKeys: [own], rejectedKeys: [foreign, traversal, "avatars/x.jpg"] });
  });

  it("does not delete a key still linked to a photo and rejects it", async () => {
    const linked = key(tripA, 1), free = key(tripA, 2);
    const ctx = setup([row({ objectKeys: [linked, free] })], { linked: [linked] });
    await processStorageDeletionJobs(ctx.deps);
    expect(ctx.storage.deleted).toEqual([free]);
    expect(ctx.jobs.rows[0]).toMatchObject({ status: "completed", resolvedKeys: [free], rejectedKeys: [linked] });
  });

  it("counts an absent object as resolved (the port answers ok)", async () => {
    const ctx = setup([row({ objectKeys: [key(tripA, 1)] })]);
    const result = await processStorageDeletionJobs(ctx.deps);
    expect(result).toMatchObject({ ok: true, value: { completed: 1, resolvedKeys: 1 } });
  });

  it("on a partial failure saves progress, counts the attempt, schedules a backoff and does not complete", async () => {
    const [a, b, c] = [key(tripA, 1), key(tripA, 2), key(tripA, 3)] as [string, string, string];
    const ctx = setup([row({ objectKeys: [a, b, c] })], { failOn: (k) => k === b });
    const result = await processStorageDeletionJobs(ctx.deps);
    expect(result).toEqual({ ok: true, value: { processed: 1, completed: 0, failed: 1, exhausted: 0, resolvedKeys: 2, rejectedKeys: 0, claimFailed: false } });
    expect(ctx.jobs.rows[0]).toMatchObject({ status: "pending", attempts: 1, resolvedKeys: [a, c], lastErrorCode: "delete_failed",
      nextAttemptAt: new Date(T0.getTime() + computeRetryDelay(1)), leaseOwner: undefined });
    expect(JSON.stringify(result)).not.toContain("secret-detail");
  });

  it("a rerun only processes the pending keys, completes and does not delete resolved keys again", async () => {
    const [a, b, c] = [key(tripA, 1), key(tripA, 2), key(tripA, 3)] as [string, string, string];
    const ctx = setup([row({ objectKeys: [a, b, c] })], { failOn: (k) => k === b });
    await processStorageDeletionJobs(ctx.deps);
    expect(ctx.storage.deleted).toEqual([a, c]);
    const retry = setup(ctx.jobs.rows);
    retry.setClock(new Date(T0.getTime() + computeRetryDelay(1)));
    const result = await processStorageDeletionJobs({ ...retry.deps, deadline: new Date(T0.getTime() + 3_600_000) });
    expect(result).toMatchObject({ ok: true, value: { processed: 1, completed: 1, resolvedKeys: 1 } });
    expect(retry.storage.deleted).toEqual([b]);
    expect(ctx.jobs.rows[0]).toMatchObject({ status: "completed", resolvedKeys: [a, c, b] });
  });

  it("does not claim a job before its nextAttemptAt", async () => {
    const ctx = setup([row({ objectKeys: [key(tripA, 1)], nextAttemptAt: new Date(T0.getTime() + 1) })]);
    const result = await processStorageDeletionJobs(ctx.deps);
    expect(result).toMatchObject({ ok: true, value: { processed: 0 } });
    expect(ctx.storage.deleted).toEqual([]);
  });

  it("is idempotent against a double claim: the second worker finds the job leased", async () => {
    const ctx = setup([row({ objectKeys: [key(tripA, 1)] })]);
    const first = await ctx.jobs.port.claimNext({ now: T0, leaseUntil: new Date(T0.getTime() + STORAGE_DELETION_LEASE_SECONDS * 1000), owner: "w1" });
    expect(first).toMatchObject({ ok: true, value: { id: jobId } });
    const result = await processStorageDeletionJobs(ctx.deps);
    expect(result).toMatchObject({ ok: true, value: { processed: 0 } });
    expect(ctx.storage.deleted).toEqual([]);
  });

  it("reclaims a job whose lease expired and the stale worker cannot overwrite the new owner", async () => {
    const [a, b] = [key(tripA, 1), key(tripA, 2)] as [string, string];
    const ctx = setup([row({ objectKeys: [a, b] })]);
    await ctx.jobs.port.claimNext({ now: T0, leaseUntil: new Date(T0.getTime() + 120_000), owner: "stale" });
    ctx.setClock(new Date(T0.getTime() + 121_000));
    const result = await processStorageDeletionJobs({ ...ctx.deps, deadline: new Date(T0.getTime() + 3_600_000) });
    expect(result).toMatchObject({ ok: true, value: { processed: 1, completed: 1 } });
    expect(await ctx.jobs.port.recordResolved(jobId, "stale", { resolved: ["zzz"], rejected: [] })).toEqual({ ok: true, value: false });
    expect(await ctx.jobs.port.releaseFailed(jobId, "stale", { now: T0, nextAttemptAt: T0, attempts: 9, status: "failed", lastErrorCode: "x" }))
      .toEqual({ ok: true, value: false });
    expect(ctx.jobs.rows[0]).toMatchObject({ status: "completed", attempts: 0, resolvedKeys: [a, b] });
  });

  it("leases the job for the configured seconds and stops without releasing when the lease is lost mid-job", async () => {
    const keys = Array.from({ length: 30 }, (_, i) => key(tripA, i + 1));
    const ctx = setup([row({ objectKeys: keys })]);
    const leases: Date[] = [];
    const original = ctx.jobs.port.claimNext;
    ctx.deps.jobs = { ...ctx.jobs.port, claimNext: async (input) => { leases.push(input.leaseUntil); return original(input); },
      recordResolved: async (...args) => { ctx.jobs.rows[0]!.leaseOwner = "other"; return ctx.jobs.port.recordResolved(...args); } };
    const result = await processStorageDeletionJobs(ctx.deps);
    expect(leases[0]).toEqual(new Date(T0.getTime() + STORAGE_DELETION_LEASE_SECONDS * 1000));
    expect(result).toMatchObject({ ok: true, value: { processed: 1, completed: 0 } });
    expect(ctx.storage.deleted).toHaveLength(25);
    expect(ctx.jobs.rows[0]).toMatchObject({ status: "pending", leaseOwner: "other", attempts: 0 });
  });

  it("persists progress in batches of 25 keys", async () => {
    const keys = Array.from({ length: 30 }, (_, i) => key(tripA, i + 1));
    const ctx = setup([row({ objectKeys: keys })]);
    const sizes: number[] = [];
    ctx.deps.jobs = { ...ctx.jobs.port, recordResolved: async (jid, owner, input) => { sizes.push(input.resolved.length); return ctx.jobs.port.recordResolved(jid, owner, input); } };
    await processStorageDeletionJobs(ctx.deps);
    expect(sizes).toEqual([25, 5]);
  });

  it("moves the job to failed after the maximum attempts without deleting it", async () => {
    const a = key(tripA, 1);
    const ctx = setup([row({ objectKeys: [a], attempts: STORAGE_DELETION_MAX_ATTEMPTS - 1 })], { failOn: () => true });
    const result = await processStorageDeletionJobs(ctx.deps);
    expect(result).toMatchObject({ ok: true, value: { processed: 1, completed: 0, failed: 1, exhausted: 1 } });
    expect(ctx.jobs.rows).toHaveLength(1);
    expect(ctx.jobs.rows[0]).toMatchObject({ status: "failed", attempts: STORAGE_DELETION_MAX_ATTEMPTS, resolvedKeys: [], objectKeys: [a] });
    const again = await processStorageDeletionJobs(ctx.deps);
    expect(again).toMatchObject({ ok: true, value: { processed: 0 } });
  });

  it("saves progress and releases without counting an attempt when the deadline arrives", async () => {
    const keys = Array.from({ length: 5 }, (_, i) => key(tripA, i + 1));
    const deadline = new Date(T0.getTime() + 1000);
    const ctx = setup([row({ objectKeys: keys })], { deadline });
    ctx.deps.storage = { ...ctx.storage.port, deleteObject: async (input) => {
      const result = await ctx.storage.port.deleteObject(input);
      if (ctx.storage.deleted.length === 2) ctx.setClock(deadline);
      return result;
    } };
    const result = await processStorageDeletionJobs(ctx.deps);
    expect(result).toMatchObject({ ok: true, value: { processed: 1, completed: 0, resolvedKeys: 2 } });
    expect(ctx.storage.deleted).toEqual(keys.slice(0, 2));
    expect(ctx.jobs.rows[0]).toMatchObject({ status: "pending", attempts: 0, resolvedKeys: keys.slice(0, 2), nextAttemptAt: deadline, lastErrorCode: "deadline" });
  });

  it("does not start a job after the deadline nor beyond maxJobs", async () => {
    const rows = [row({ objectKeys: [key(tripA, 1)] }), row({ id: jobId2, objectKeys: [key(tripA, 2)] })];
    const expired = setup(rows, { deadline: T0 });
    expect(await processStorageDeletionJobs(expired.deps)).toMatchObject({ ok: true, value: { processed: 0 } });
    const limited = setup(rows, { maxJobs: 1 });
    expect(await processStorageDeletionJobs(limited.deps)).toMatchObject({ ok: true, value: { processed: 1, completed: 1 } });
    expect(rows.map((r) => r.status)).toEqual(["completed", "pending"]);
  });

  it("completes a job with every key already settled without touching the storage", async () => {
    const a = key(tripA, 1);
    const ctx = setup([row({ objectKeys: [a], resolvedKeys: [a] })]);
    expect(await processStorageDeletionJobs(ctx.deps)).toMatchObject({ ok: true, value: { completed: 1, resolvedKeys: 0 } });
    expect(ctx.storage.deleted).toEqual([]);
  });

  it("treats a link lookup failure as a failed key and does not delete", async () => {
    const a = key(tripA, 1);
    const ctx = setup([row({ objectKeys: [a] })]);
    ctx.deps.links = { findLinkedKeys: async () => err(new UnknownError("boom")) };
    const result = await processStorageDeletionJobs(ctx.deps);
    expect(result).toMatchObject({ ok: true, value: { failed: 1, completed: 0 } });
    expect(ctx.storage.deleted).toEqual([]);
    expect(ctx.jobs.rows[0]).toMatchObject({ status: "pending", attempts: 1, lastErrorCode: "link_check_failed" });
  });

  it("bounds a progress-save failure to that job and keeps processing the next one", async () => {
    const rows = [row({ objectKeys: [key(tripA, 1)] }), row({ id: jobId2, objectKeys: [key(tripA, 2)] })];
    const ctx = setup(rows);
    let calls = 0;
    ctx.deps.jobs = { ...ctx.jobs.port, recordResolved: async (...args) => (++calls === 1 ? err(new UnknownError("mongo-secret")) : ctx.jobs.port.recordResolved(...args)) };
    const result = await processStorageDeletionJobs(ctx.deps);
    expect(result).toMatchObject({ ok: true, value: { processed: 2, completed: 1, failed: 1 } });
    expect(rows[0]).toMatchObject({ status: "pending", attempts: 1, lastErrorCode: "progress_not_saved" });
    expect(rows[1]).toMatchObject({ status: "completed" });
    expect(JSON.stringify(result)).not.toContain("mongo-secret");
  });

  it("reports a claim failure in the summary without throwing", async () => {
    const ctx = setup([]);
    ctx.deps.jobs = { ...ctx.jobs.port, claimNext: async () => err(new UnknownError("mongo-secret")) };
    const result = await processStorageDeletionJobs(ctx.deps);
    expect(result).toEqual({ ok: true, value: { processed: 0, completed: 0, failed: 0, exhausted: 0, resolvedKeys: 0, rejectedKeys: 0, claimFailed: true } });
  });
});
