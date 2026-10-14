/**
 * The in-process calls a tool makes go through the rate limiter like any request (the cost
 * documented in docs/mcp.md: 1 for the /mcp POST + 1-2 per tool). If a refactor ever made
 * injected calls free, this fails.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";

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
  process.env.RATE_LIMIT_MAX = "3";
  app = await buildApp({ authKey: kp.publicKey });
  jwt = await new SignJWT({ email: "mcp-rl@example.com" })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject("mcp-rl")
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(kp.privateKey);
});
afterAll(async () => {
  process.env.RATE_LIMIT_MAX = "10000";
  await app.close();
  await closeDb();
});

const call = (id: number) =>
  app.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      authorization: `Bearer ${jwt}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    payload: {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: "list_portfolios", arguments: {} },
    },
  });

describe("rate limiting of tool calls", () => {
  it("counts the inner API request against the same per-credential bucket", async () => {
    // Budget is 3. Call 1 = outer (1) + inner (2). Call 2 = outer (3) ok, inner (4) -> 429.
    const first = await call(1);
    expect(first.json().result.isError ?? false).toBe(false);
    const second = await call(2);
    expect(second.statusCode).toBe(200);
    const result = second.json().result;
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({ status: 429 });
    // And the bucket really is exhausted for the outer endpoint too.
    expect((await call(3)).statusCode).toBe(429);
  });
});
