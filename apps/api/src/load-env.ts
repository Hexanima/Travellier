import { fileURLToPath } from "node:url";

import { config } from "dotenv";

export const apiEnvPath = fileURLToPath(new URL("../.env", import.meta.url));

export const loadApiEnvironment = (
  environment: Record<string, string | undefined> = process.env,
  path: string = apiEnvPath,
): void => {
  config({ path, processEnv: environment, override: false, quiet: true });
};
