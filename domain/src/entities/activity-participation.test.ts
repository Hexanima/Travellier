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
