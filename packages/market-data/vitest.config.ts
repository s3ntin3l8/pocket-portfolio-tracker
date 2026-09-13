import path from "node:path";
import { defineConfig } from "vitest/config";

const pkg = (name: string) => path.resolve(import.meta.dirname, `../${name}/src/index.ts`);

export default defineConfig({
  resolve: {
    alias: {
      "@portfolio/core": pkg("core"),
    },
  },
  test: {
    globals: true,
    environment: "node",
  },
});
