/**
 * The chat endpoint has its own cost cap, per *user* (a turn can fan out into several model
 * calls). It must not be resettable by presenting a different credential string — a refreshed
 * access token or a freshly minted PAT is the same user.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";

import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";

const ISSUER = "https://auth.test/application/o/portfolio/";
const AUDIENCE = "portfolio-tracker";
type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let key: CryptoKey;
let modelCalls = 0;

const sign = (sub: string) =>
  new SignJWT({ email: `${sub}@example.com`, jti: Math.random().toString(36) })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);

beforeAll(async () => {
  const kp = await generateKeyPair("ES256");
  key = kp.privateKey;
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
});
afterAll(async () => {
  process.env.ASSISTANT_RATE_LIMIT_MAX = "30";
  await app.close();
  await closeDb();
});

const chat = (token: string, payload: unknown = { messages: [{ role: "user", content: "hi" }] }) =>
  app.inject({
    method: "POST",
    url: "/assistant/chat",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: payload as object,
  });

describe("assistant rate limit", () => {
  it("caps chat turns per user, across different credentials, before any model call", async () => {
    // Three distinct login tokens for the same user.
    const [t1, t2, t3] = [await sign("rl-a"), await sign("rl-a"), await sign("rl-a")];
    expect(t1).not.toBe(t2);
    expect((await chat(t1)).statusCode).toBe(200);
    expect((await chat(t2)).statusCode).toBe(200);
    const limited = await chat(t3);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: "assistant_rate_limited" });
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect(modelCalls).toBe(2); // the third request never reached the model
  });

  it("is per user: another user is unaffected, and the status endpoint is not capped", async () => {
    expect((await chat(await sign("rl-b"))).statusCode).toBe(200);
    const status = await app.inject({
      method: "GET",
      url: "/assistant/status",
      headers: { authorization: `Bearer ${await sign("rl-a")}` },
    });
    expect(status.statusCode).toBe(200);
  });

  it("does not spend budget on invalid requests", async () => {
    const t = await sign("rl-c");
    for (let i = 0; i < 5; i++) expect((await chat(t, { messages: [] })).statusCode).toBe(400);
    expect((await chat(t)).statusCode).toBe(200);
    expect((await chat(t)).statusCode).toBe(200);
    expect((await chat(t)).statusCode).toBe(429);
  });
});
