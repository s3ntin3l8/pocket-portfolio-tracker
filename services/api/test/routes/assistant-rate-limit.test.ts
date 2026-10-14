/**
 * The chat endpoint has its own per-credential cost cap (a turn can fan out into several
 * model calls), separate from the API-wide limit.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";

import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";

const ISSUER = "https://auth.test/application/o/portfolio/";
const AUDIENCE = "portfolio-tracker";
type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let tokenA: string;
let tokenB: string;
let modelCalls = 0;

const sign = (sub: string, key: CryptoKey) =>
  new SignJWT({ email: `${sub}@example.com` })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);

beforeAll(async () => {
  const kp = await generateKeyPair("ES256");
  process.env.AUTHENTIK_ISSUER = ISSUER;
  process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
  process.env.RATE_LIMIT_MAX = "10000";
  process.env.ASSISTANT_RATE_LIMIT_MAX = "2";
  app = await buildApp({
    authKey: kp.publicKey,
    chatProvider: {
      name: "fake",
      label: "Fake",
      local: true,
      isConfigured: () => true,
      complete: async () => {
        modelCalls++;
        return { text: "hi", toolCalls: [], stop: "end" };
      },
    },
  });
  tokenA = await sign("rl-a", kp.privateKey);
  tokenB = await sign("rl-b", kp.privateKey);
});
afterAll(async () => {
  process.env.ASSISTANT_RATE_LIMIT_MAX = "10000";
  await app.close();
  await closeDb();
});

const chat = (token: string) =>
  app.inject({
    method: "POST",
    url: "/assistant/chat",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: { messages: [{ role: "user", content: "hi" }] },
  });

describe("assistant rate limit", () => {
  it("caps chat turns per credential before any model call is made", async () => {
    expect((await chat(tokenA)).statusCode).toBe(200);
    expect((await chat(tokenA)).statusCode).toBe(200);
    const limited = await chat(tokenA);
    expect(limited.statusCode).toBe(429);
    expect(modelCalls).toBe(2); // the third request never reached the model
  });

  it("counts per credential: another user is unaffected, and the status endpoint is not capped", async () => {
    expect((await chat(tokenB)).statusCode).toBe(200);
    const status = await app.inject({
      method: "GET",
      url: "/assistant/status",
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(status.statusCode).toBe(200);
  });
});
