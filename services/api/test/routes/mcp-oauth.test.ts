/**
 * OAuth for AI connectors (claude.ai / mobile → /mcp): protected-resource metadata, the 401
 * challenge, and connector tokens — a dedicated Authentik provider's audience/issuer — treated
 * like personal access tokens (read-only unless granted the write scope, never admin).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";

const ISSUER = "https://auth.test/application/o/portfolio/";
const AUDIENCE = "portfolio-tracker";
const MCP_ISSUER = "https://auth.test/application/o/claude-connector/";
const MCP_AUDIENCE = "claude-connector-client";
const API_URL = "https://api.example.test";
const METADATA = `${API_URL}/.well-known/oauth-protected-resource/mcp`;

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let privateKey: CryptoKey;

async function sign(
  claims: Record<string, unknown>,
  o: { sub: string; iss: string; aud: string; exp?: string },
) {
  return new SignJWT({ email: `${o.sub}@example.com`, ...claims })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(o.sub)
    .setIssuer(o.iss)
    .setAudience(o.aud)
    .setIssuedAt()
    .setExpirationTime(o.exp ?? "1h")
    .sign(privateKey);
}
const web = (sub: string, claims: Record<string, unknown> = {}) =>
  sign(claims, { sub, iss: ISSUER, aud: AUDIENCE });
const connector = (sub: string, claims: Record<string, unknown> = {}) =>
  sign(claims, { sub, iss: MCP_ISSUER, aud: MCP_AUDIENCE });
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
/** A connector token acts for an existing user, so make the account first (a normal web login). */
const withAccount = async (sub: string, claims: Record<string, unknown> = {}) => {
  await app.inject({ method: "GET", url: "/me", headers: auth(await web(sub)) });
  return connector(sub, claims);
};

let nextId = 1;
const rpc = (token: string | null, method: string, params: unknown = {}) =>
  app.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      ...(token ? auth(token) : {}),
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    payload: { jsonrpc: "2.0", id: nextId++, method, params },
  });
const toolNames = async (token: string) =>
  ((await rpc(token, "tools/list")).json().result.tools as { name: string }[]).map((t) => t.name);

beforeAll(async () => {
  const kp = await generateKeyPair("ES256");
  privateKey = kp.privateKey;
  process.env.AUTHENTIK_ISSUER = ISSUER;
  process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
  process.env.AUTHENTIK_ADMIN_GROUP = "portfolio-admins";
  process.env.AUTHENTIK_MCP_AUDIENCE = MCP_AUDIENCE;
  process.env.AUTHENTIK_MCP_ISSUER = MCP_ISSUER;
  process.env.PUBLIC_API_URL = `${API_URL}/`;
  process.env.RATE_LIMIT_MAX = "10000";
  app = await buildApp({ authKey: kp.publicKey });
});
afterAll(async () => {
  await app.close();
  await closeDb();
  for (const k of [
    "AUTHENTIK_ADMIN_GROUP",
    "AUTHENTIK_MCP_AUDIENCE",
    "AUTHENTIK_MCP_ISSUER",
    "PUBLIC_API_URL",
    "RATE_LIMIT_MAX",
  ])
    delete process.env[k];
});

describe("protected resource metadata (RFC 9728)", () => {
  it("is public and points at the connector's authorization server", async () => {
    for (const url of [
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-protected-resource",
    ]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        resource: `${API_URL}/mcp`,
        authorization_servers: [MCP_ISSUER],
        scopes_supported: ["openid", "email", "profile", "pocket:write"],
        bearer_methods_supported: ["header"],
        resource_name: "Pocket",
      });
      expect(res.headers["cache-control"]).toMatch(/public/);
      expect(res.headers["access-control-allow-origin"]).toBe("*");
    }
  });
});

describe("401 challenge", () => {
  it("tells an unauthenticated client where the metadata is, on /mcp only", async () => {
    const none = await rpc(null, "tools/list");
    expect(none.statusCode).toBe(401);
    expect(none.headers["www-authenticate"]).toBe(`Bearer resource_metadata="${METADATA}"`);

    const bad = await rpc("not-a-token", "tools/list");
    expect(bad.statusCode).toBe(401);
    expect(bad.headers["www-authenticate"]).toBe(
      `Bearer resource_metadata="${METADATA}", error="invalid_token"`,
    );

    const elsewhere = await app.inject({ method: "GET", url: "/portfolios" });
    expect(elsewhere.statusCode).toBe(401);
    expect(elsewhere.headers["www-authenticate"]).toBeUndefined();
  });
});

describe("connector tokens", () => {
  it("authenticate on /mcp read-only by default: read tools, no write tool", async () => {
    const t = await withAccount("oauth-reader", { scope: "openid email" });
    const names = await toolNames(t);
    expect(names).toContain("list_portfolios");
    expect(names).not.toContain("propose_transactions");
  });

  it("are read-only: reads work, writes are refused like a read PAT", async () => {
    const t = await withAccount("oauth-reader2", { scope: "openid" });
    expect(
      (await app.inject({ method: "GET", url: "/portfolios", headers: auth(t) })).statusCode,
    ).toBe(200);
    const blocked = await app.inject({
      method: "POST",
      url: "/portfolios",
      headers: auth(t),
      payload: { name: "nope", baseCurrency: "eur" },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toBe("read_only_token");
  });

  it("with the write scope (string or array claim) get the write tool and may write", async () => {
    for (const claims of [{ scope: "openid pocket:write" }, { scp: ["openid", "pocket:write"] }]) {
      const sub = `oauth-writer-${Object.keys(claims)[0]}`;
      const t = await withAccount(sub, claims);
      expect(await toolNames(t)).toContain("propose_transactions");
      const made = await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(t),
        payload: { name: "From connector", baseCurrency: "eur" },
      });
      expect(made.statusCode).toBe(201);
    }
  });

  it("are the same user as the web login, so they see the same data", async () => {
    const w = await web("oauth-same-user");
    await app.inject({
      method: "POST",
      url: "/portfolios",
      headers: auth(w),
      payload: { name: "Shared Depot", baseCurrency: "eur" },
    });
    const t = await withAccount("oauth-same-user", { scope: "openid" });
    const list = await app.inject({ method: "GET", url: "/portfolios", headers: auth(t) });
    expect(list.json().map((p: { name: string }) => p.name)).toEqual(["Shared Depot"]);
  });

  it("are never admin, even with the admin group claim", async () => {
    const adminWeb = await web("oauth-admin", { groups: ["portfolio-admins"] });
    expect(
      (await app.inject({ method: "GET", url: "/admin/providers", headers: auth(adminWeb) }))
        .statusCode,
    ).toBe(200);
    const t = await withAccount("oauth-admin", {
      groups: ["portfolio-admins"],
      scope: "pocket:write",
    });
    const res = await app.inject({ method: "GET", url: "/admin/providers", headers: auth(t) });
    expect(res.statusCode).toBe(403);
    const me = await app.inject({ method: "GET", url: "/me", headers: auth(t) });
    expect(me.json().isAdmin).toBe(false);
  });

  it("can't mint credentials: a connector token is not an interactive session", async () => {
    const t = await withAccount("oauth-minter", { scope: "pocket:write" });
    const res = await app.inject({
      method: "POST",
      url: "/me/tokens",
      headers: auth(t),
      payload: { name: "escalate", scope: "write" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("interactive_session_required");
  });

  it("must come from the connector's own issuer and audience", async () => {
    const claims = { scope: "pocket:write" };
    const probe = async (t: string) =>
      (await app.inject({ method: "GET", url: "/portfolios", headers: auth(t) })).statusCode;
    expect(
      await probe(await sign(claims, { sub: "x1", iss: MCP_ISSUER, aud: "someone-else" })),
    ).toBe(401);
    expect(
      await probe(await sign(claims, { sub: "x2", iss: "https://evil.test/", aud: MCP_AUDIENCE })),
    ).toBe(401);
    // Connector audience under the web issuer is neither token: rejected.
    expect(await probe(await sign(claims, { sub: "x3", iss: ISSUER, aud: MCP_AUDIENCE }))).toBe(
      401,
    );
    // A web token is not accepted as the connector (no cross-audience reuse in the other direction).
    expect(await probe(await sign(claims, { sub: "x4", iss: MCP_ISSUER, aud: AUDIENCE }))).toBe(
      401,
    );
    expect(
      await probe(
        await sign(claims, { sub: "x5", iss: MCP_ISSUER, aud: MCP_AUDIENCE, exp: "-1h" }),
      ),
    ).toBe(401);
  });

  it("never create or rebind an account: a user must have logged in on the web first", async () => {
    const t = await connector("oauth-never-logged-in", { scope: "pocket:write" });
    const res = await app.inject({ method: "GET", url: "/portfolios", headers: auth(t) });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("account_required");
    // …and nothing was created: the same token still fails after a web login elsewhere is absent.
    expect(
      (await app.inject({ method: "GET", url: "/portfolios", headers: auth(t) })).json().error,
    ).toBe("account_required");
    // Once the user has an account, the same token works.
    await app.inject({
      method: "GET",
      url: "/me",
      headers: auth(await web("oauth-never-logged-in")),
    });
    expect(
      (await app.inject({ method: "GET", url: "/portfolios", headers: auth(t) })).statusCode,
    ).toBe(200);
  });

  it("don't change what a normal web login gets: full write access and the write tool", async () => {
    const w = await web("oauth-web-user");
    expect(await toolNames(w)).toContain("propose_transactions");
    const made = await app.inject({
      method: "POST",
      url: "/portfolios",
      headers: auth(w),
      payload: { name: "Web Depot", baseCurrency: "eur" },
    });
    expect(made.statusCode).toBe(201);
  });
});
