import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { type JWT } from "next-auth/jwt";
import { type User } from "next-auth";

// authConfig.providers is computed once at module import time from AUTHENTIK_ISSUER /
// AUTH_LOCAL_SECRET, so each case needs its own fresh module registry + dynamic import
// rather than the single top-level import auth.test.ts uses.

const authentikFactory = vi.fn(() => ({ id: "authentik" }));
vi.mock("next-auth", () => ({ default: vi.fn((config) => config) }));
vi.mock("next-auth/providers/authentik", () => ({ default: authentikFactory }));

const ENV_KEYS = ["AUTH_SECRET", "AUTHENTIK_ISSUER", "AUTH_LOCAL_SECRET"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  authentikFactory.mockClear();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("authConfig.providers — Authentik registration", () => {
  // DEV_AUTH_TOKEN dev workflows (PR #627) leave AUTHENTIK_ISSUER unset. Registering the
  // Authentik provider unconditionally made Auth.js's config validation (assertConfig)
  // throw InvalidEndpoints on every /api/auth/* call — including AuthSessionProvider's
  // 60s poll (session-provider.tsx), which fires regardless of DEV_AUTH_TOKEN.
  it("omits the Authentik provider when AUTHENTIK_ISSUER is unset", async () => {
    process.env.AUTH_SECRET = "test-secret-1234567890-test-secret-12345"; // pragma: allowlist secret
    delete process.env.AUTHENTIK_ISSUER;
    delete process.env.AUTH_LOCAL_SECRET;

    vi.resetModules();
    const { authConfig } = await import("../src/auth");

    expect(authentikFactory).not.toHaveBeenCalled();
    expect(authConfig.providers).not.toContainEqual(expect.objectContaining({ id: "authentik" }));
  });

  it("registers the Authentik provider when AUTHENTIK_ISSUER is set", async () => {
    process.env.AUTH_SECRET = "test-secret-1234567890-test-secret-12345"; // pragma: allowlist secret
    process.env.AUTHENTIK_ISSUER = "https://authentik.test";
    delete process.env.AUTH_LOCAL_SECRET;

    vi.resetModules();
    const { authConfig } = await import("../src/auth");

    expect(authentikFactory).toHaveBeenCalled();
    expect(authConfig.providers).toContainEqual(expect.objectContaining({ id: "authentik" }));
  });
});

describe("authConfig.callbacks.jwt — refresh guard when Authentik isn't configured", () => {
  // A stale cookie can carry a refreshToken/expiresAt from a PRIOR Authentik session
  // (e.g. a dev environment that had real Authentik configured, then switched to
  // AUTHENTIK_ISSUER unset for DEV_AUTH_TOKEN). Without this guard, jwt() would call
  // tokenEndpoint(), which builds a URL from an empty issuer and throws "Invalid URL" —
  // caught, but firing (and mislogged as a network error) on every 60s session poll.
  it("errors out immediately instead of attempting a refresh, and never calls fetch", async () => {
    process.env.AUTH_SECRET = "test-secret-1234567890-test-secret-12345"; // pragma: allowlist secret
    delete process.env.AUTHENTIK_ISSUER;
    delete process.env.AUTH_LOCAL_SECRET;

    vi.resetModules();
    const { authConfig } = await import("../src/auth");
    const jwt = authConfig.callbacks?.jwt;
    if (!jwt) throw new Error("jwt callback must be defined");

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const token = {
      accessToken: "access-stale",
      refreshToken: "refresh-stale-from-prior-authentik-session",
      expiresAt: Math.floor(Date.now() / 1000) - 10, // expired
    } as JWT;

    const res = await jwt({ token, user: {} as User });

    expect(res?.error).toBe("RefreshTokenMissing");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
