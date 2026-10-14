/**
 * A read-only POST (`scope: "read"`, i.e. /mcp) must not flush the valuation/derivation
 * caches the way every other non-GET does — otherwise each MCP call would discard them.
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
  app = await buildApp({ authKey: kp.publicKey });
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
    await new Promise((r) => setTimeout(r, 25));
    expect(clearValuation).not.toHaveBeenCalled();

    const write = await app.inject({
      method: "POST",
      url: "/portfolios",
      headers: headers(),
      payload: { name: "cache-probe", baseCurrency: "eur" },
    });
    expect(write.statusCode).toBe(201);
    await new Promise((r) => setTimeout(r, 25));
    expect(clearValuation).toHaveBeenCalled();
  });
});
