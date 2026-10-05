import { describe, expect, it } from "vitest";
import * as domain from "../index.js";

const transition = (status: domain.ActivityStatus) => {
  expect(domain.transitionAfterActivityVote).toBeTypeOf("function");
  return domain.transitionAfterActivityVote(status);
};

describe("activity voting policy", () => {
  it("starts voting for a proposed activity", () => {
    expect(transition("proposed")).toEqual(domain.ok("voting"));
  });
  it("keeps voting open without inventing a consensus threshold", () => {
    expect(transition("voting")).toEqual(domain.ok("voting"));
  });
  it("rejects votes on confirmed activities", () => {
    expect(transition("confirmed")).toMatchObject({ ok: false, error: { tag: "ActivityVotingClosedError" } });
  });
});
