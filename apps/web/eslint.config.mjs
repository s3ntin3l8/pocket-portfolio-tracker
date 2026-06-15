import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // public/ holds static assets + serwist's generated service worker (public/sw.js).
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "public/**"],
  },
];

export default eslintConfig;
