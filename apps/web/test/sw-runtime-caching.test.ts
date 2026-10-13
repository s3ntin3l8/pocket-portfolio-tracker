import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * `sw.ts` is a service-worker entrypoint (needs `self`/Serwist globals), so its caching
 * policy is pinned at the source level: the immutable-build-asset route must be bounded,
 * or hashed chunks from every past deploy pile up in `public-static-v1` forever.
 */
const sw = readFileSync(path.resolve(__dirname, "../src/app/sw.ts"), "utf8");

describe("service worker runtime caching", () => {
  it("bounds the public-static CacheFirst route with an ExpirationPlugin", () => {
    expect(sw).toMatch(/import \{[^}]*\bExpirationPlugin\b[^}]*\} from "serwist"/);
    expect(sw).toMatch(
      /new CacheFirst\(\{[^}]*cacheName: PUBLIC_STATIC_CACHE[^}]*plugins: \[new ExpirationPlugin\(\{ maxEntries: 200 \}\)\]/s,
    );
  });
});
