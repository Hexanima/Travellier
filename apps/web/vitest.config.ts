import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        alias: {
            "app-domain": fileURLToPath(
                new URL("../../domain/src/index.ts", import.meta.url),
            ),
        },
    },
    test: {
        coverage: {
            exclude: ["**/index.ts", "src/errors/generic-errors/**/*"],
        },
        // T104: los recorridos conectados corren con `yarn test:integration` (levantan mongod, de a un archivo).
        exclude: [...configDefaults.exclude, "test-integration/**"],
        passWithNoTests: false,
    },
});
