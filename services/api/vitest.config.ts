import path from "node:path";
import { defineConfig } from "vitest/config";

const pkg = (name: string) =>
  path.resolve(import.meta.dirname, `../../packages/${name}/src/index.ts`);

export default defineConfig({
  resolve: {
    // Resolve workspace packages to their TS source so tests need no prior build.
    alias: {
      "@portfolio/db": pkg("db"),
      "@portfolio/core": pkg("core"),
      "@portfolio/schema": pkg("schema"),
      "@portfolio/market-data": pkg("market-data"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    // Builds one pre-migrated PGlite template once (see global-setup.ts); setup.ts
    // then copies it into each file's tmp dir instead of every file bootstrapping +
    // migrating its own PGlite cluster from scratch (~1.4s vs ~0.13s per file).
    globalSetup: ["./test/global-setup.ts"],
    setupFiles: ["./test/setup.ts"],
    // PGlite (embedded Postgres) has a multi-second cold start; give DB-backed
    // tests room under parallel load.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
