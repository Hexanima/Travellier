import { describe, expect, it } from "vitest";
import * as domain from "../index.js";

const id = (n: number) => {
  const result = domain.createObjectId(n.toString(16).padStart(24, "0"));
  if (!result.ok) throw result.error;
  return result.value;
};
const input = { id: id(1), tripId: id(2), activityId: id(3), userId: id(4),
  value: "up", createdAt: new Date("2026-10-04T12:00:00.789Z") };
const create = (patch: Record<string, unknown> = {}) => {
  expect(domain.createActivityVote).toBeTypeOf("function");
  return domain.createActivityVote({ ...input, ...patch } as never);
};

describe("ActivityVote", () => {
  it.each(["up", "down"])("accepts %s with individual references and server time", (value) => {
    expect(create({ value })).toEqual(domain.ok({ ...input, value }));
  });
  it.each([undefined, null, "", "going", "UP", 1, {}, []])("rejects invalid value %s", (value) => {
    expect(create({ value })).toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "value" }] } });
  });
  it.each([undefined, null, "2026-10-04", new Date(NaN)])("rejects invalid creation time %s", (createdAt) => {
    expect(create({ createdAt })).toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "createdAt" }] } });
  });
  it("copies the timestamp so input mutation cannot change the vote", () => {
    const createdAt = new Date(input.createdAt);
    const result = create({ createdAt });
    if (!result.ok) throw result.error;
    createdAt.setTime(0);
    expect(result.value.createdAt).toEqual(input.createdAt);
  });
});
