import { describe, expect, it } from "vitest";
import * as domain from "../index.js";

const id = (n: number) => {
  const result = domain.createObjectId(n.toString(16).padStart(24, "0"));
  if (!result.ok) throw result.error;
  return result.value;
};
const input = { id: id(1), tripId: id(2), activityId: id(3), userId: id(4),
  status: "going", updatedAt: new Date("2026-10-04T12:00:00.789Z") };
const create = (patch: Record<string, unknown> = {}) => {
  expect(domain.createActivityParticipation).toBeTypeOf("function");
  return domain.createActivityParticipation({ ...input, ...patch } as never);
};

describe("ActivityParticipation", () => {
  it.each(["going", "not_going", "pending"])("accepts %s with individual references and server time", (status) => {
    expect(create({ status })).toEqual(domain.ok({ ...input, status }));
  });
  it.each([undefined, null, "", "confirmed", "GOING", 1, {}, []])("rejects invalid status %s", (status) => {
    expect(create({ status })).toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "status" }] } });
  });
  it.each([undefined, null, "2026-10-04", new Date(NaN)])("rejects invalid update time %s", (updatedAt) => {
    expect(create({ updatedAt })).toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "updatedAt" }] } });
  });
  it("copies the timestamp so input mutation cannot change the participation", () => {
    const updatedAt = new Date(input.updatedAt);
    const result = create({ updatedAt });
    if (!result.ok) throw result.error;
    updatedAt.setTime(0);
    expect(result.value.updatedAt).toEqual(input.updatedAt);
  });
});

describe("ActivityParticipation decisionRequired (T53)", () => {
  const changedAt = new Date("2026-11-08T10:00:00.123Z");
  const mark = { reason: "schedule_conflict", changedFields: ["scheduledAt", "durationMinutes"], changedAt };
  it("copies a valid marker on pending and clones changedAt", () => {
    const result = create({ status: "pending", decisionRequired: { ...mark, changedAt: new Date(changedAt) } });
    if (!result.ok) throw result.error;
    expect(result.value.decisionRequired).toEqual(mark);
    expect(result.value.decisionRequired!.changedAt).not.toBe(changedAt);
  });
  it.each(["going", "not_going"])("rejects a marker on %s", (status) => {
    expect(create({ status, decisionRequired: mark })).toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "decisionRequired" }] } });
  });
  it("treats a null marker as absent", () => {
    expect(create({ status: "going", decisionRequired: null })).toMatchObject({ ok: true });
  });
  it.each([
    { ...mark, changedFields: [] }, { ...mark, changedFields: ["scheduledAt", "scheduledAt"] },
    { ...mark, changedFields: ["title"] }, { ...mark, reason: "other" }, { ...mark, changedAt: new Date(NaN) },
    { ...mark, changedAt: "2026-11-08" }, "x",
  ])("rejects an invalid marker %j", (decisionRequired) => {
    expect(create({ status: "pending", decisionRequired })).toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "decisionRequired" }] } });
  });
});
