import { defineConfig, devices } from "@playwright/test";
import { apiPort, stackEnv, webPort, webUrl } from "./e2e/stack-env.mjs";

/**
 * The web e2e suite (real browser, real API). Boots a `make dev`-equivalent stack: the
 * API on a throwaway PGlite database seeded with the demo dataset, and `next dev`, with
 * the DEV_AUTH_TOKEN bypass (no Authentik). Ports default to 3101 (API) / 3105 (web);
 * override with E2E_API_PORT / E2E_WEB_PORT.
 *
 * Runs locally (`npm run e2e --workspace @portfolio/web`) AND in CI — the `e2e` job in
 * .github/workflows/ci-cd.yml. The CI job builds the workspace packages first: the API
 * resolves them from dist/, so there is no dist/ to run against otherwise.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./e2e/global-setup.ts",
  // One shared dev API/DB and its rate limit: run serially.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Locally the list reporter is all you need; in CI the HTML report is written to
  // apps/web/playwright-report/ and uploaded as a job artifact.
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: webUrl,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command: "node e2e/start-api.mjs",
      url: `http://localhost:${apiPort}/health`,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `npx next dev -p ${webPort}`,
      url: `${webUrl}/en/holdings`,
      timeout: 240_000,
      reuseExistingServer: false,
      env: { ...stackEnv, NEXT_TELEMETRY_DISABLED: "1" },
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
