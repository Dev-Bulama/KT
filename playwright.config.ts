import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run the real application against a dedicated database
 * (E2E_DATABASE_URL, default katdict_e2e). The database is reset by
 * tests/e2e/global-setup.ts — never point it at production data.
 */
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://katdict:katdict@localhost:5432/katdict_e2e";
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    actionTimeout: 30_000,
    navigationTimeout: 90_000,
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : undefined,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Production build: stable (no dev recompiles) and closest to the deployed app.
    command: process.env.E2E_DEV ? `npx next dev -p ${PORT}` : `npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 600_000,
    env: {
      DATABASE_URL: DB, DIRECT_URL: DB, AUTH_SECRET: "e2e-only-secret-0123456789abcdef0123456789abcdef", APP_URL: `http://localhost:${PORT}`,
      EMAIL_PROVIDER: "console", STORAGE_DRIVER: "local", AI_PROVIDER: "disabled", CRON_SECRET: "e2e-cron", LOG_LEVEL: "warn",
      NEXT_DIST_DIR: ".next-e2e",
      // Test-only: permit local file storage in the production build used for E2E.
      UNSAFE_ALLOW_LOCAL_STORAGE: "true",
    },
  },
});
