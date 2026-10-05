import { afterEach, describe, expect, it, vi } from "vitest";
import { MongoBinary } from "mongodb-memory-server";
import config from "../vitest.config.js";

const loadSetup = async () => {
  expect(config.test?.globalSetup).toEqual(["./test/mongodb-global-setup.ts"]);
  return (await import("./mongodb-global-setup.js")).default;
};

describe("MongoDB binary preparation before parallel suites", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("waits for the binary to be ready before allowing test workers to start", async () => {
    const setup = await loadSetup();
    let release!: (path: string) => void, announceStarted!: () => void;
    const binaryReady = new Promise<string>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { announceStarted = resolve; });
    vi.spyOn(MongoBinary, "getPath").mockImplementation(() => { announceStarted(); return binaryReady; });
    let finished = false;
    const preparation = setup().then(() => { finished = true; });
    await started;
    expect(finished).toBe(false);
    release("/cached/mongod");
    await preparation;
    expect(finished).toBe(true);
  });

  it("fails setup if binary preparation fails instead of starting suites with a missing binary", async () => {
    const setup = await loadSetup();
    const failure = new Error("binary download failed");
    vi.spyOn(MongoBinary, "getPath").mockRejectedValue(failure);
    await expect(setup()).rejects.toBe(failure);
  });
});
