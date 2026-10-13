import { describe, expect, it } from "vitest";
import * as domain from "./index.js";

describe("active domain contract after T47", () => {
  it.each(["createActivityVote", "getTripActivityVote", "setTripActivityVote", "transitionAfterActivityVote",
    "ActivityVotingDisabledError", "ActivityVotingClosedError"])("does not export %s", (name) => {
    expect(domain).not.toHaveProperty(name);
  });
});
