import { defineConfig } from "vitest/config";

// Tests for the repo-level tooling (the demo instance's isolation guard).
export default defineConfig({
  test: {
    name: "scripts",
    include: ["scripts/**/*.test.mjs"],
    root: new URL("..", import.meta.url).pathname,
  },
});
