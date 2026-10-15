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
      expect.arrayContaining([
        "list_portfolios",
        "get_net_worth",
        "get_holdings",
        "explain_tax_concept",
        "get_fsa_allocation",
        "resolve_instrument",
        "explain_import_duplicates",
      ]),
    );
    expect(tools.length).toBeGreaterThanOrEqual(16);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });

  it("explains a tax concept and runs the new-cash what-if through a read-scoped token", async () => {
    const tax = await callTool(ownerPat, "explain_tax_concept", { concept: "vorabpauschale" });
    expect(tax.isError).toBe(false);
    expect(tax.data).toMatchObject({ concept: "vorabpauschale", taxRegime: "DE" });
    expect(tax.data).not.toHaveProperty("caveat");

    const whatIf = await callTool(ownerPat, "get_rebalancing", {
      dimension: "asset_class",
      newCash: "250.50",
    });
    expect(whatIf.isError).toBe(false);
    expect(whatIf.data).toMatchObject({ newCash: "250.50", trades: [], fxMissingCurrencies: [] });

    // Not a positive decimal string: refused by the tool's schema, not computed.
    const bad = await rpc(ownerPat, "tools/call", {
      name: "get_rebalancing",
      arguments: { dimension: "asset_class", newCash: "-1" },
    });
    expect(bad.json().result?.isError ?? !!bad.json().error).toBe(true);
  });

  it("explain_import_duplicates answers import_not_found for another user's import", async () => {
    const writePat = await mintPat(await jwt("mcp-owner"), "write");
    const made = await callTool(writePat, "propose_transactions", {
      transactions: [
        {
          action: "buy",
          name: "Dup Corp",
          ticker: "DUP",
          quantity: "1",
          price: "10",
          currency: "EUR",
          executedAt: "2026-04-02T00:00:00.000Z",
        },
      ],
    });
    const own = await callTool(ownerPat, "explain_import_duplicates", {
      importId: made.data.importId,
    });
    expect(own.isError).toBe(false);
    expect(own.data).toMatchObject({ draftCount: 1, flagged: [] });
    const foreign = await callTool(otherPat, "explain_import_duplicates", {
      importId: made.data.importId,
    });
    expect(foreign.isError).toBe(true);
    expect(foreign.data).toEqual({ error: "import_not_found", status: 404 });
  });

  it("offers propose_transactions only to a write-scoped token, annotated as a non-destructive write", async () => {
    const readTools = (await rpc(ownerPat, "tools/list")).json().result.tools as { name: string }[];
    expect(readTools.map((t) => t.name)).not.toContain("propose_transactions");

    const writePat = await mintPat(await jwt("mcp-owner"), "write");
    const tools = (await rpc(writePat, "tools/list")).json().result.tools as {
      name: string;
      annotations?: Record<string, boolean>;
    }[];
    const propose = tools.find((t) => t.name === "propose_transactions")!;
    expect(propose.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });
    // Every other tool is still annotated read-only.
    expect(
      tools
        .filter((t) => t.name !== "propose_transactions")
        .every((t) => t.annotations?.readOnlyHint === true),
    ).toBe(true);
  });

  it("creates a draft import through the write tool, and a read token cannot call it", async () => {
    const owner = await jwt("mcp-owner");
    const writePat = await mintPat(owner, "write");
    const args = {
      transactions: [
        {
          action: "buy",
          name: "Mcp Corp",
          ticker: "MCP",
          quantity: "3",
          price: "10",
          currency: "EUR",
          executedAt: "2026-04-01T00:00:00.000Z",
        },
      ],
    };
    const made = await callTool(writePat, "propose_transactions", args);
    expect(made.isError).toBe(false);
    expect(made.data).toMatchObject({ draftCount: 1, alreadyConfirmed: false });
    expect(made.data.reviewPath).toBe(`/transactions/import/${made.data.importId}`);
    expect(String(made.data.note)).toMatch(/still has to review and confirm/);

    // Nothing was booked: still a draft import the user has to confirm.
    const imp = await app.inject({
      method: "GET",
      url: `/imports/${made.data.importId}`,
      headers: auth(owner),
    });
    expect(imp.json().status).toBe("draft");

    // A read-only token is not even offered the tool; calling it by name is refused.
    const refused = await rpc(ownerPat, "tools/call", {
      name: "propose_transactions",
      arguments: args,
    });
    const body = refused.json();
    expect(body.error ?? body.result?.isError).toBeTruthy();
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
  it("refuses an id that tries to redirect the call to another endpoint", async () => {
    const res = await rpc(ownerPat, "tools/call", {
      name: "get_portfolio_summary",
      arguments: { portfolioId: "x/../../me/tokens" },
    });
    const body = res.json();
    // Rejected at input validation: no API call is made, no token metadata comes back.
    expect(body.error ?? body.result?.isError).toBeTruthy();
    expect(JSON.stringify(body)).not.toMatch(/mcp-read|lastUsedAt/);
  });
});
