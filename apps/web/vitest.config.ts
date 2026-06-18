import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // More-specific stubs must come before the broad `@` alias so Vite matches them first.
      // next-intl/navigation calls next/navigation which can't resolve in jsdom.
      {
        find: "@/i18n/navigation",
        replacement: fileURLToPath(new URL("./test/stubs/i18n-navigation.ts", import.meta.url)),
      },
      // Mirror the tsconfig `@/*` → src/* path so component imports resolve in tests.
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
      // The `server-only` guard throws outside RSC; stub it so server-side lib code
      // (e.g. lib/server-api.ts) can be unit-tested under jsdom.
      {
        find: "server-only",
        replacement: fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url)),
      },
    ],
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
  },
});
