import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { apiEnvPath, loadApiEnvironment } from "./load-env.js";

const temporaryDirectories: string[] = [];

const fixturePath = () => {
  const directory = mkdtempSync(join(tmpdir(), "travellier-env-"));
  temporaryDirectories.push(directory);
  return join(directory, ".env");
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("API environment loading", () => {
  it("resolves .env relative to the API rather than the terminal directory", () => {
    expect(apiEnvPath).toBe(fileURLToPath(new URL("../.env", import.meta.url)));
  });

  it("loads quoted values from .env into the supplied environment", () => {
    const path = fixturePath();
    writeFileSync(path, 'PORT=3010\nJWT_SECRET="test-secret-with-#"\n');
    const environment: Record<string, string | undefined> = {};

    loadApiEnvironment(environment, path);

    expect(environment).toEqual({ PORT: "3010", JWT_SECRET: "test-secret-with-#" });
  });

  it("preserves settings already supplied by the process environment", () => {
    const path = fixturePath();
    writeFileSync(path, "PORT=3010\nJWT_SECRET=file-secret\n");
    const environment = { PORT: "3020", JWT_SECRET: "process-secret" };

    loadApiEnvironment(environment, path);

    expect(environment).toEqual({ PORT: "3020", JWT_SECRET: "process-secret" });
  });

  it("allows starting without a file when settings are injected externally", () => {
    const environment = { JWT_SECRET: "process-secret" };

    expect(() => loadApiEnvironment(environment, fixturePath())).not.toThrow();
    expect(environment).toEqual({ JWT_SECRET: "process-secret" });
  });
});
