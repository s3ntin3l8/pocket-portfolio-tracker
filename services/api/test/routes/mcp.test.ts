/**
 * Remote MCP endpoint: auth (incl. read-scoped PATs, which must be able to POST it),
 * per-user isolation through the in-process client, redaction, and error flagging.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";

import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";

const ISSUER = "https://auth.test/application/o/portfolio/";
const AUDIENCE = "portfolio-tracker";
type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let privateKey: CryptoKey;

async function jwt(sub: string) {
  return new SignJWT({ email: `${sub}@example.com` })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function mintPat(owner: string, scope: "read" | "write") {
  const res = await app.inject({
    method: "POST",
    url: "/me/tokens",
    headers: auth(owner),
    payload: { name: `mcp-${scope}`, scope },
  });
  expect(res.statusCode).toBe(201);
  return res.json().token as string;
}

let nextId = 1;
function rpc(token: string | null, method: string, params: unknown = {}) {
  return app.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      ...(token ? auth(token) : {}),
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    payload: { jsonrpc: "2.0", id: nextId++, method, params },
  });
}
async function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
  const res = await rpc(token, "tools/call", { name, arguments: args });
  expect(res.statusCode).toBe(200);
  const result = res.json().result as {
    isError?: boolean;
    content: { type: string; text: string }[];
  };
  return { isError: result.isError ?? false, data: JSON.parse(result.content[0]!.text) };
}

describe("POST /mcp", () => {
  let ownerPat: string;
  let otherPat: string;

  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp({ authKey: kp.publicKey });
    const owner = await jwt("mcp-owner");
    const other = await jwt("mcp-other");
    ownerPat = await mintPat(owner, "read");
    otherPat = await mintPat(other, "read");

    const mk = (t: string, payload: Record<string, unknown>) =>
      app.inject({ method: "POST", url: "/portfolios", headers: auth(t), payload });
    const a = await mk(owner, {
      name: "Owner Depot",
      baseCurrency: "eur",
      accountNumber: "ACCT-SECRET-123",
      iban: "DE89370400440532013000",
    });
    expect(a.statusCode).toBe(201);
    const b = await mk(other, { name: "Other Depot", baseCurrency: "eur" });
    expect(b.statusCode).toBe(201);
  });
  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it("rejects an unauthenticated request", async () => {
    expect((await rpc(null, "tools/list")).statusCode).toBe(401);
  });

  it("is POST-only (stateless): GET and DELETE answer 405", async () => {
    for (const method of ["GET", "DELETE"] as const) {
      const res = await app.inject({ method, url: "/mcp" });
      expect(res.statusCode).toBe(405);
      expect(res.headers.allow).toBe("POST");
    }
  });

  it("lets a read-scoped PAT call the MCP POST, while other POSTs stay blocked", async () => {
    expect((await rpc(ownerPat, "tools/list")).statusCode).toBe(200);
    const blocked = await app.inject({
      method: "POST",
      url: "/portfolios",
      headers: auth(ownerPat),
      payload: { name: "nope", baseCurrency: "eur" },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toBe("read_only_token");
  });

  it("initializes and carries the glossary as server instructions", async () => {
    const res = await rpc(ownerPat, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect(res.statusCode).toBe(200);
    const result = res.json().result;
    expect(result.serverInfo.name).toBe("pocket");
    expect(result.instructions).toMatch(/net contributed/);
  });

  it("lists the read-only tools, all annotated readOnly", async () => {
    const tools = (await rpc(ownerPat, "tools/list")).json().result.tools as {
      name: string;
      annotations?: { readOnlyHint?: boolean };
    }[];
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["list_portfolios", "get_net_worth", "get_holdings"]),
    );
    expect(tools.length).toBeGreaterThanOrEqual(12);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });

  it("scopes tool data to the caller and never returns account numbers or IBANs", async () => {
    // Precondition: the secrets really are stored, so the absence below is not vacuous.
    const direct = await app.inject({ method: "GET", url: "/portfolios", headers: auth(ownerPat) });
    expect(JSON.stringify(direct.json())).toContain("ACCT-SECRET-123");
    expect(JSON.stringify(direct.json())).toContain("DE89370400440532013000");
    const mine = await callTool(ownerPat, "list_portfolios");
    expect(mine.isError).toBe(false);
    expect(mine.data.map((p: { name: string }) => p.name)).toEqual(["Owner Depot"]);
    expect(JSON.stringify(mine.data)).not.toMatch(/ACCT-SECRET|DE89370400440532013000/);
    const theirs = await callTool(otherPat, "list_portfolios");
    expect(theirs.data.map((p: { name: string }) => p.name)).toEqual(["Other Depot"]);
  });

  it("runs a derived-number tool end to end through the API", async () => {
    const nw = await callTool(ownerPat, "get_net_worth");
    expect(nw.isError).toBe(false);
    expect(nw.data).toMatchObject({ displayCurrency: expect.any(String), holdingCount: 0 });
    expect(typeof nw.data.netWorth).toBe("string");
  });

  it("flags a failing call as a sanitized tool error", async () => {
    const out = await callTool(ownerPat, "get_portfolio_summary", {
      portfolioId: "00000000-0000-0000-0000-000000000000",
    });
    expect(out.isError).toBe(true);
    expect(out.data).toMatchObject({ status: 404 });
    expect(Object.keys(out.data).sort()).toEqual(["error", "status"]);
  });

  it("can't read another user's portfolio by id", async () => {
    const list = await callTool(otherPat, "list_portfolios");
    const otherId = list.data[0].id as string;
    const out = await callTool(ownerPat, "get_portfolio_summary", { portfolioId: otherId });
    expect(out.isError).toBe(true);
    expect(out.data.status).toBe(404);
  });

  it("serves the glossary resource and the prompts", async () => {
    const res = await rpc(ownerPat, "resources/read", { uri: "pocket://glossary" });
    expect(res.json().result.contents[0].text).toMatch(/Cash boundary/);
    const prompts = (await rpc(ownerPat, "prompts/list")).json().result.prompts as {
      name: string;
    }[];
    expect(prompts.map((p) => p.name).sort()).toEqual([
      "monthly_review",
      "rebalancing_plan",
      "tax_year_check",
    ]);
    const got = await rpc(ownerPat, "prompts/get", {
      name: "tax_year_check",
      arguments: { year: "2025" },
    });
    expect(got.json().result.messages[0].content.text).toMatch(/2025/);
  });

  it("rejects invalid tool input with a protocol error, not a crash", async () => {
    const res = await rpc(ownerPat, "tools/call", {
      name: "search_transactions",
      arguments: { pageSize: 9999 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.error ?? body.result?.isError).toBeTruthy();
  });
});
