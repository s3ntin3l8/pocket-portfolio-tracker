import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // PGlite (embedded Postgres) has a multi-second cold start, and replaying every
    // migration on a loaded host can outlast the 10 s default (as in services/api).
    // A timed-out beforeAll is worse than slow: afterAll then closes the client under
    // the running migrate, and the worker was seen spinning in PGlite's WASM for
    // over an hour instead of failing.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
