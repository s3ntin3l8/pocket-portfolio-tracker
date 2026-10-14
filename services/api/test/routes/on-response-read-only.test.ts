/**
 * Exercises the `scope: "read"` exception in the global onResponse write-invalidation hook
 * (services/api/src/app.ts): a read-only POST (i.e. /mcp and /assistant/chat) must not flush the valuation and
 * derivation caches the way every other non-GET does — otherwise each MCP call would discard them.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { generateKeyPair, SignJWT } from "jose";

const clearValuation = vi.hoisted(() => vi.fn());
vi.mock("../../src/services/valuation.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  clearValuationCache: clearValuation,
}));

import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";

const ISSUER = "https://auth.test/application/o/portfolio/";
const AUDIENCE = "portfolio-tracker";
type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let jwt: string;

beforeAll(async () => {
  const kp = await generateKeyPair("ES256");
  process.env.AUTHENTIK_ISSUER = ISSUER;
  process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
  process.env.RATE_LIMIT_MAX = "10000";
  app = await buildApp({
    authKey: kp.publicKey,
    chatProvider: {
      name: "fake",
      label: "Fake",
      local: true,
      isConfigured: () => true,
      complete: async () => ({ text: "hi", toolCalls: [], stop: "end" }),
    },
  });
  jwt = await new SignJWT({ email: "mcp-cache@example.com" })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject("mcp-cache")
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(kp.privateKey);
});
afterAll(async () => {
  await app.close();
  await closeDb();
});

const headers = () => ({
  authorization: `Bearer ${jwt}`,
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
});

describe("cache invalidation hook", () => {
  it("does not fire for POST /mcp but still fires for a real write", async () => {
    clearValuation.mockClear();
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: headers(),
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(res.statusCode).toBe(200);

    const write = await app.inject({
      method: "POST",
      url: "/portfolios",
      headers: headers(),
      payload: { name: "cache-probe", baseCurrency: "eur" },
    });
    expect(write.statusCode).toBe(201);
    // onResponse runs after the reply is flushed; wait for the write's flush rather than
    // guessing a delay. Exactly one flush means the earlier /mcp POST did not add one.
    await vi.waitFor(() => expect(clearValuation).toHaveBeenCalled());
    expect(clearValuation).toHaveBeenCalledTimes(1);
  });
  it("does not fire for a streamed POST /assistant/chat turn either", async () => {
    clearValuation.mockClear();
    const res = await app.inject({
      method: "POST",
      url: "/assistant/chat",
      headers: headers(),
      payload: { messages: [{ role: "user", content: "hello" }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("event: done");

    const write = await app.inject({
      method: "POST",
      url: "/portfolios",
      headers: headers(),
      payload: { name: "cache-probe-2", baseCurrency: "eur" },
    });
    expect(write.statusCode).toBe(201);
    await vi.waitFor(() => expect(clearValuation).toHaveBeenCalled());
    expect(clearValuation).toHaveBeenCalledTimes(1);
  });
});
