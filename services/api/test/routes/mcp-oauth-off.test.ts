/** Without the connector configured, /mcp stays personal-access-token only: no metadata, no challenge. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair } from "jose";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;

beforeAll(async () => {
  const kp = await generateKeyPair("ES256");
  process.env.RATE_LIMIT_MAX = "10000";
  app = await buildApp({ authKey: kp.publicKey });
});
afterAll(async () => {
  await app.close();
  await closeDb();
  delete process.env.RATE_LIMIT_MAX;
});

describe("connector OAuth not configured", () => {
  it("serves no protected-resource metadata", async () => {
    for (const url of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ]) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(404);
    }
  });

  it("answers an unauthenticated /mcp with a plain 401 (no OAuth challenge)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers["www-authenticate"]).toBeUndefined();
  });
});
