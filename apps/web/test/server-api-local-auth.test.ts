import { describe, it, expect, vi, beforeEach } from "vitest";

// Local password auth (AUTH_LOCAL_SECRET) with no Authentik issuer and no
// DEV_AUTH_TOKEN — a self-hosted deployment that signs in through
// /auth/local/login. getServerApi must still resolve the session cookie here:
// gating on AUTHENTIK_ISSUER alone left every RSC read tokenless, so each page
// rendered the "Can't reach the API" state even though the same-origin proxy
// served the identical data to the client.
const h = vi.hoisted(() => {
  delete process.env.DEV_AUTH_TOKEN;
  delete process.env.AUTHENTIK_ISSUER;
  process.env.AUTH_SECRET = "test-secret-1234567890-test-secret-12345"; // pragma: allowlist secret
  process.env.AUTH_LOCAL_SECRET = "local-secret-1234567890-abcdefghij"; // pragma: allowlist secret
  process.env.API_URL = "http://localhost:3000";
  return { client: {} as Record<string, (...args: never[]) => unknown> };
});

vi.mock("@portfolio/api-client", () => ({ createApiClient: () => h.client }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [{ name: "__Secure-authjs.session-token", value: "encrypted-jwt" }],
  }),
}));
vi.mock("../src/lib/session-token", () => ({
  accessTokenFromCookieHeader: async (cookieHeader: string) =>
    cookieHeader.includes("__Secure-authjs.session-token") ? "local-access-token" : null,
}));

import * as api from "../src/lib/server-api";

beforeEach(() => {
  h.client = { listAccountHolders: async () => [] };
});

describe("RSC reads under local password auth", () => {
  it("resolves the session cookie instead of degrading to unavailable", async () => {
    h.client.me = async () => ({ id: "u1", authSub: "local|owner@example.com", email: "o@e.com" });

    expect(await api.loadMe()).toMatchObject({ id: "u1" });
  });

  it("still reports empty rather than unavailable when the account has no portfolios", async () => {
    h.client.listPortfolios = async () => [];

    expect(await api.loadContributions()).toEqual({ status: "empty" });
  });
});
