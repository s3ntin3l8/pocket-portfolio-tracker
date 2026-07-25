import { describe, it, expect, vi, beforeEach } from "vitest";

// DEV_AUTH_TOKEN is the fast-path bypass: when set, getServerApi uses it as the
// Bearer token directly, skipping both the OIDC session cookie and the authConfigured
// check. This file sets it in the hoisted block so the module-level `devToken`
// constant captures it at import time.
const h = vi.hoisted(() => {
  process.env.DEV_AUTH_TOKEN = "pt_dev-test-token";
  process.env.API_URL = "http://localhost:3000";
  return {
    client: {} as Record<string, (...args: never[]) => unknown>,
  };
});

vi.mock("@portfolio/api-client", () => ({ createApiClient: () => h.client }));

import * as api from "../src/lib/server-api";

beforeEach(() => {
  h.client = {
    listAccountHolders: async () => [],
  };
});

describe("DEV_AUTH_TOKEN fast path", () => {
  it("loads me when DEV_AUTH_TOKEN is set, no session cookie needed", async () => {
    h.client.me = async () => ({ id: "u1", authSub: "sub", email: "test@test" });
    expect(await api.loadMe()).toMatchObject({ id: "u1" });
  });

  it("is unavailable when the API throws", async () => {
    h.client.me = async () => {
      throw new Error("x");
    };
    expect(await api.loadMe()).toBeNull();
  });
});
