import { describe, expect, it } from "vitest";

import { createHealthResponse } from "./app.js";

describe("api app", () => {
  it("builds the Travellier health response", async () => {
    const response = await createHealthResponse();

    expect(response).toEqual({
      app: "travellier",
      status: "ready",
    });
  });
});
