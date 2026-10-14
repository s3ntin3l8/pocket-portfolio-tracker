import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// eslint-config-next 16 ships native ESLint flat config arrays under these subpaths,
// so we spread them directly instead of bridging legacy configs via FlatCompat.
// Colour literals bypass the theme tokens in `src/app/globals.css` (and the light/dark
// switch). Use a token instead: Tailwind classes (`bg-primary/15`, `text-gold-fg`,
// `border-warning/40`), `var(--token)` / `color-mix(in srgb, var(--token) N%, transparent)`
// in style props and chart attributes, or `tint()` from `@/lib/tint` for badge pairs.
// Matches hex colours (#abc, #aabbcc, #aabbccdd) and rgb()/rgba()/hsl()/hsla() inside any
// string or template literal; comments are not matched.
const COLOUR_LITERAL =
  "(#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])|\\b(?:rgb|hsl)a?\\()";
const colourMessage =
  "No colour literals (hex / rgb[a] / hsl[a]) — use a theme token from globals.css (e.g. bg-primary/15, var(--violet), tint() from @/lib/tint). See eslint.config.mjs for the allowlist.";

// Arbitrary pixel/rem font sizes and radii bypass the named scale in `src/app/globals.css`
// (@theme: text-micro/body-sm/body/heading/display/hero + xs/sm/base/lg, radius xs..xl).
// Only literal px/rem values are matched, so `text-[clamp(...)]` and `text-[var(--x)]` pass.
const SCALE_LITERAL = "\\b(?:text|rounded)-\\[[0-9.]+(?:px|rem)\\]";
const scaleMessage =
  "No arbitrary text-[Npx]/rounded-[Npx] — use the named type/radius scale from globals.css @theme (text-micro/body-sm/body/heading/display/hero, text-xs..lg, rounded-xs..xl).";
const scaleRules = [
  { selector: `Literal[value=/${SCALE_LITERAL}/]`, message: scaleMessage },
  { selector: `TemplateElement[value.raw=/${SCALE_LITERAL}/]`, message: scaleMessage },
];
const colourAllowlist = [
  "src/components/theme-color-sync.tsx",
  "src/lib/brokerages.ts",
  "src/app/[[]locale]/layout.tsx",
];

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // eslint-plugin-react (bundled by eslint-config-next 16) auto-detects the React
    // version via an ESLint-10-removed API; pin it so detection is skipped.
    settings: { react: { version: "19" } },
  },
  {
    // eslint-config-next ships its own @typescript-eslint/no-unused-vars ("warn", no
    // ignore pattern) — this config array doesn't extend the root eslint.config.js, so
    // it doesn't inherit that config's `^_` ignore pattern. Restore it here so the
    // leading-underscore "intentionally unused" convention (used throughout the rest of
    // the monorepo) is honored in apps/web too, instead of silently warning on it.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    // Allowlist (each needs a concrete colour string, not a CSS variable):
    //  - theme-color-sync.tsx / [locale]/layout.tsx: <meta name="theme-color"> is read by the
    //    browser chrome outside the CSS cascade, so it cannot use var().
    //  - lib/brokerages.ts: hash-derived hsl() hues for unknown brokerages — computed per name
    //    at runtime, so there is no token to point at.
    ignores: colourAllowlist,
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: `Literal[value=/${COLOUR_LITERAL}/]`,
          message: colourMessage,
        },
        {
          selector: `TemplateElement[value.raw=/${COLOUR_LITERAL}/]`,
          message: colourMessage,
        },
        ...scaleRules,
      ],
    },
  },
  {
    // The colour allowlist above must still obey the type/radius scale. Flat-config
    // `no-restricted-syntax` entries replace (not merge), so this block carries only
    // the scale rules for exactly the files the colour block skips.
    files: colourAllowlist,
    rules: { "no-restricted-syntax": ["error", ...scaleRules] },
  },
  {
    // public/ holds static assets + serwist's generated service worker (public/sw.js);
    // coverage/ is a generated (gitignored) Vitest artifact, not source.
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "public/**", "coverage/**"],
  },
];

export default eslintConfig;
