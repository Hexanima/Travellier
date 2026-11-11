import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// T104: recorridos del cliente contra el handler REAL de la API (MongoDB en memoria y almacenamiento falso).
// Un solo worker: cada archivo levanta su propio mongod y la PC tiene poca memoria.
export default defineConfig({
    resolve: {
        alias: {
            "app-domain": fileURLToPath(
                new URL("../../domain/src/index.ts", import.meta.url),
            ),
        },
    },
    test: {
        environment: "jsdom",
        include: ["test-integration/**/*.test.tsx"],
        setupFiles: ["./test-integration/support/node-realm.ts"],
        globalSetup: ["../api/test/mongodb-global-setup.ts"],
        pool: "forks",
        maxWorkers: 1,
        fileParallelism: false,
        testTimeout: 60_000,
        hookTimeout: 120_000,
        passWithNoTests: false,
    },
});
