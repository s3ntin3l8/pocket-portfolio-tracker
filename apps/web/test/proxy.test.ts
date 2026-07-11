import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl/middleware", () => ({
  default: () => () => new Response(null, { status: 200 }),
}));

import { bypassI18n, config, isAllowedHost } from "../src/proxy";

function headersWith(opts: { host?: string; xForwardedHost?: string }): Headers {
  const h = new Headers();
  if (opts.host) h.set("host", opts.host);
  if (opts.xForwardedHost) h.set("x-forwarded-host", opts.xForwardedHost);
  return h;
}

describe("proxy host guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.AUTH_URL;
    delete process.env.WEB_ALLOWED_HOSTS;
  });

  it("allows the AUTH_URL host in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.AUTH_URL = "https://portfolio.example.com";

    expect(isAllowedHost(headersWith({ host: "portfolio.example.com" }))).toBe(true);
  });

  it("allows WEB_ALLOWED_HOSTS entries in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.WEB_ALLOWED_HOSTS = "app.example.com, https://admin.example.com";

    expect(isAllowedHost(headersWith({ host: "app.example.com" }))).toBe(true);
    expect(isAllowedHost(headersWith({ host: "admin.example.com" }))).toBe(true);
  });

  it("rejects unexpected production hosts", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.AUTH_URL = "https://portfolio.example.com";

    expect(isAllowedHost(headersWith({ host: "evil.example.com" }))).toBe(false);
  });

  it("allows localhost-style hosts outside production only", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isAllowedHost(headersWith({ host: "localhost:3005" }))).toBe(true);
    expect(isAllowedHost(headersWith({ host: "127.0.0.1:3005" }))).toBe(true);

    vi.stubEnv("NODE_ENV", "production");
    expect(isAllowedHost(headersWith({ host: "localhost:3005" }))).toBe(false);
  });

  it("prefers x-forwarded-host over host — the same header Auth.js's trustHost derives its origin from", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.AUTH_URL = "https://portfolio.example.com";

    // A benign Host (matches Traefik's own address) but a forwarded host claiming to be
    // the trusted origin — must be evaluated against x-forwarded-host, not host.
    expect(
      isAllowedHost(
        headersWith({ host: "internal-traefik:80", xForwardedHost: "portfolio.example.com" }),
      ),
    ).toBe(true);
    // And a spoofed x-forwarded-host must be rejected even if `host` looks fine.
    expect(
      isAllowedHost(
        headersWith({ host: "portfolio.example.com", xForwardedHost: "evil.example.com" }),
      ),
    ).toBe(false);
  });

  it("rejects when neither header is present", () => {
    expect(isAllowedHost(headersWith({}))).toBe(false);
  });

  it("matches Auth.js and backend-proxy routes but bypasses i18n routing for them", () => {
    expect(config.matcher).toContain("/api/auth/:path*");
    expect(config.matcher).toContain("/api/backend/:path*");
    expect(bypassI18n("/api/auth/signin")).toBe(true);
    expect(bypassI18n("/api/backend/portfolios")).toBe(true);
    expect(bypassI18n("/dashboard")).toBe(false);
  });
});
