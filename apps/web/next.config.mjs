import { randomUUID } from "node:crypto";
import createNextIntlPlugin from "next-intl/plugin";
import withSerwistInit from "@serwist/next";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Service worker: precaches the Next app shell so the PWA is installable + offline-
// capable. Disabled in dev so `next dev` hot-reload isn't fighting a cache. The
// generated public/sw.js is a build artifact (gitignored). Registration is auto-injected.
// `@serwist/next` precaches build assets but not App Router page HTML, so the offline
// fallback page (referenced in src/app/sw.ts) is added explicitly; the per-build
// revision busts its cache on every deploy.
const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV !== "production",
  additionalPrecacheEntries: [{ url: "/en/offline", revision: randomUUID() }],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow the LAN host used for dev (matches the IP in .env.local) to fetch /_next/*
  // cross-origin without the Next.js dev warning. Hostname only — no protocol/port.
  allowedDevOrigins: ["192.168.2.152"],
  // Allow importing workspace TS packages directly.
  transpilePackages: [
    "@portfolio/schema",
    "@portfolio/core",
    "@portfolio/market-data",
    "@portfolio/api-client",
  ],
  // Baseline security headers (pre-internet-exposure hardening). CSP is deliberately NOT
  // here yet — a strict CSP on Next + next-intl + serwist needs nonce wiring and a
  // report-only tuning pass first; these headers are safe/non-breaking on their own.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Also covered by CSP's frame-ancestors once that lands; kept here as its own
          // backstop since it's supported more broadly (older browsers, non-CSP clients).
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // 2 years, subdomains included — long-lived HSTS is only safe to set once TLS is
          // confirmed working everywhere this host (and its subdomains) is ever served from.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default withNextIntl(withSerwist(nextConfig));
