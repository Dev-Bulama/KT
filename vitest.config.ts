import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    projects: [
      {
        plugins: [tsconfigPaths()],
        test: { name: "unit", include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"], environment: "node" },
      },
      {
        plugins: [tsconfigPaths()],
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          setupFiles: ["tests/integration/setup-env.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          // One database: run files sequentially.
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
