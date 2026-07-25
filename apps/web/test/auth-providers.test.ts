import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
