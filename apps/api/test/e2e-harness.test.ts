import { describe, expect, it } from "vitest";

import { assertIsolatedEnvironment } from "./e2e-harness.js";

describe("isolation guard of the integrated API journeys (T103)", () => {
  const isolated = { MONGODB_URI: "mongodb://127.0.0.1:27017/?replicaSet=rs0", MONGODB_DATABASE_NAME: "t103_journey" };

  it("accepts only the loopback in-memory database with the t103_ prefix and no bucket", () => {
    expect(() => assertIsolatedEnvironment(isolated)).not.toThrow();
    expect(() => assertIsolatedEnvironment({ ...isolated, MONGODB_URI: "mongodb://localhost:50000/" })).not.toThrow();
  });

  it.each([
    ["an Atlas URI", { MONGODB_URI: "mongodb+srv://user:secret@cluster0.example.mongodb.net/app" }],
    ["a remote host", { MONGODB_URI: "mongodb://db.example.com:27017/" }],
    ["credentials in the URI", { MONGODB_URI: "mongodb://user:secret@127.0.0.1:27017/" }],
    ["a missing URI", { MONGODB_URI: undefined }],
    ["a database without the prefix", { MONGODB_DATABASE_NAME: "travellier" }],
    ["a configured bucket", { S3_BUCKET_NAME: "some-real-bucket" }],
  ])("refuses %s", (_label, override) => {
    expect(() => assertIsolatedEnvironment({ ...isolated, ...override })).toThrow();
  });
});
