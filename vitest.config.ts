import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
export default defineConfig({
  resolve: {
    alias: {
      "@tell-aviv/shared": resolve("packages/shared/src/index.ts"),
      "@tell-aviv/database": resolve("packages/database/src/index.ts"),
      "@tell-aviv/auth": resolve("packages/auth/src/index.ts"),
      "@tell-aviv/game-sdk": resolve("packages/game-sdk/src/index.ts"),
      "@tell-aviv/game-runtime": resolve("packages/game-runtime/src/index.ts"),
      "@tell-aviv/games": resolve("games/registry.ts"),
    },
  },
  test: {
    // Each database case drains only its own keys; browser tests use normal wakeups.
    env: { STORAGE_CLEANUP_IMMEDIATE: "false" },
    include: [
      "tests/**/*.test.ts",
      "games/**/*.test.ts",
      "packages/**/*.test.ts",
      "apps/realtime/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**"],
    maxWorkers: 2,
  },
});
