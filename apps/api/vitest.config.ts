import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        alias: {
            "app-domain": fileURLToPath(
                new URL("../../domain/src/index.ts", import.meta.url),
            ),
        },
    },
    test: {
        globalSetup: ["./test/mongodb-global-setup.ts"],
        coverage: {
            exclude: ["**/index.ts", "src/errors/generic-errors/**/*"],
        },
        passWithNoTests: false,
    },
});
