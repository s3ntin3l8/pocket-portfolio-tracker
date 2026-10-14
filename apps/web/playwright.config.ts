import { defineConfig, devices } from "@playwright/test";
import { apiPort, stackEnv, webPort, webUrl } from "./e2e/stack-env.mjs";

/**
 * Local-only e2e (not wired into CI — see CONTRIBUTING.md "Web e2e"). Boots a
 * `make dev`-equivalent stack: the API on a throwaway PGlite database seeded with the demo
 * dataset, and `next dev`, with the DEV_AUTH_TOKEN bypass (no Authentik). Ports default to
 * 3101 (API) / 3105 (web); override with E2E_API_PORT / E2E_WEB_PORT.
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
  reporter: [["list"]],
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
