import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
    },
  },
  {
    // Repo-level tooling (demo instance, screenshots), run by plain node.
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    // Its audit functions are handed to page.evaluate() and run in the browser.
    files: ["scripts/ui-walkthrough.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/drizzle/**",
      "**/coverage/**",
      "**/.next/**",
      "**/.turbo/**",
    ],
  },
);
