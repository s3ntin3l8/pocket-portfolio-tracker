/**
 * AI-assisted entry: `POST /imports/propose` creates DRAFT imports only. Covers the auth/scope
 * gate, validation, dedup (file-level and cross-source), the confirm gates, and that nothing
 * is committed until the user confirms.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { screenshotImports, transactions } from "@portfolio/db";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/client.js";
import { classifyMatch, parserToTxSource } from "../../src/services/parsers/dedup.js";

const ISSUER = "https://auth.test/application/o/portfolio/";
const AUDIENCE = "portfolio-tracker";
type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let privateKey: CryptoKey;
let owner: string;
let other: string;
let portfolioId: string;

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

const BUY = {
  assetClass: "equity",
  action: "buy",
  ticker: "BBCA",
  name: "Bank Central Asia",
  quantity: "100",
  unit: "shares",
  price: "9500",
  fees: "0",
  currency: "IDR",
  executedAt: "2026-01-15T00:00:00.000Z",
};
const propose = (token: string | null, body: unknown) =>
  app.inject({
    method: "POST",
    url: "/imports/propose",
    headers: { ...(token ? auth(token) : {}), "content-type": "application/json" },
    payload: body as object,
  });
const rows = () => getDb().select().from(transactions);

beforeAll(async () => {
  const kp = await generateKeyPair("ES256");
  privateKey = kp.privateKey;
  process.env.AUTHENTIK_ISSUER = ISSUER;
  process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
  process.env.RATE_LIMIT_MAX = "10000";
  process.env.PUBLIC_WEB_URL = "https://pocket.example.test/";
  app = await buildApp({ authKey: kp.publicKey });
  owner = await jwt("propose-owner");
  other = await jwt("propose-other");
  const mk = async (t: string, name: string) =>
    (
      await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(t),
        payload: { name, baseCurrency: "IDR" },
      })
    ).json().id as string;
  portfolioId = await mk(owner, "Owner Depot");
  await mk(other, "Other Depot");
});
afterAll(async () => {
  await app.close();
  await closeDb();
  delete process.env.PUBLIC_WEB_URL;
  delete process.env.RATE_LIMIT_MAX;
});

describe("auth and scope", () => {
  it("requires authentication", async () => {
    expect((await propose(null, { transactions: [BUY] })).statusCode).toBe(401);
  });

  it("refuses a read-only token — a draft is still a write", async () => {
    const mint = await app.inject({
      method: "POST",
      url: "/me/tokens",
      headers: auth(owner),
      payload: { name: "ro", scope: "read" },
    });
    const res = await propose(mint.json().token, { transactions: [BUY] });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("read_only_token");
  });

  it("accepts a write-scoped token", async () => {
    const mint = await app.inject({
      method: "POST",
      url: "/me/tokens",
      headers: auth(owner),
      payload: { name: "rw", scope: "write" },
    });
    const res = await propose(mint.json().token, {
      transactions: [{ ...BUY, description: "write token" }],
    });
    expect(res.statusCode).toBe(201);
  });
});

describe("validation", () => {
  const bad = async (body: unknown) => {
    const res = await propose(owner, body);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_request");
    return res.json();
  };

  it("rejects empty, oversized and unknown-field proposals", async () => {
    await bad({});
    await bad({ transactions: [] });
    await bad({ transactions: Array.from({ length: 101 }, () => BUY) });
    await bad({ transactions: [BUY], surprise: true });
    await bad({ transactions: [{ ...BUY, externalId: "forged" }] });
    await bad({ transactions: [{ ...BUY, confidence: 1 }] });
    await bad({ transactions: [{ ...BUY, taxComponents: { quellensteuer: "5" } }] });
    await bad({ transactions: [{ ...BUY, attention: [] }] });
  });

  it("rejects malformed values and a security with no identifier, reporting where", async () => {
    await bad({ transactions: [{ ...BUY, quantity: "ten" }] });
    await bad({ transactions: [{ ...BUY, currency: "euro" }] });
    await bad({ transactions: [{ ...BUY, executedAt: "not a date" }] });
    await bad({ transactions: [{ ...BUY, action: "gift" }] });
    const res = await bad({ transactions: [{ ...BUY, ticker: undefined, name: undefined }] });
    expect(res.issues[0].message).toMatch(/ticker, isin, wkn or name/);
    expect(res.issues.length).toBeLessThanOrEqual(5);
  });

  it("404s a portfolio that is not the caller's, and 400s a non-uuid", async () => {
    const otherPortfolio = (
      await app.inject({ method: "GET", url: "/portfolios", headers: auth(other) })
    ).json()[0].id;
    expect(
      (await propose(owner, { portfolioId: otherPortfolio, transactions: [BUY] })).statusCode,
    ).toBe(404);
    expect(
      (
        await propose(owner, {
          portfolioId: "00000000-0000-4000-8000-000000000000",
          transactions: [BUY],
        })
      ).statusCode,
    ).toBe(404);
    expect((await propose(owner, { portfolioId: "nope", transactions: [BUY] })).statusCode).toBe(
      400,
    );
  });
});

describe("a proposal is a draft import — nothing is committed", () => {
  const SELL = { ...BUY, action: "sell", quantity: "40", price: "9700", description: "proposal A" };

  it("stores drafts with server-set confidence and ids, and books nothing", async () => {
    const before = (await rows()).length;
    const res = await propose(owner, { portfolioId, transactions: [SELL] });
    expect(res.statusCode).toBe(201);
    const out = res.json();
    expect(out).toMatchObject({
      draftCount: 1,
      alreadyExists: false,
      alreadyConfirmed: false,
      likelyDuplicates: 0,
      portfolioId,
      reviewPath: `/transactions/import/${out.importId}`,
      // PUBLIC_WEB_URL (trailing slash tolerated) turns the path into a link external clients can open.
      reviewUrl: `https://pocket.example.test/transactions/import/${out.importId}`,
    });

    expect((await rows()).length).toBe(before);
    const [imp] = await getDb()
      .select()
      .from(screenshotImports)
      .where(eq(screenshotImports.id, out.importId));
    expect(imp).toMatchObject({ status: "draft", parser: "ai", portfolioId });
    const draft = (imp!.parsedJson as { drafts: Record<string, unknown>[] }).drafts[0]!;
    expect(draft.confidence).toBe(0.5);
    expect(String(draft.externalId)).toMatch(/^ai:/);

    // Visible in the normal review API, like any other draft import.
    const got = await app.inject({
      method: "GET",
      url: `/imports/${out.importId}`,
      headers: auth(owner),
    });
    expect(got.statusCode).toBe(200);
    expect(got.json().status).toBe("draft");
  });

  it("is idempotent: the same proposal is the same import", async () => {
    const body = { portfolioId, transactions: [{ ...SELL, description: "idempotent" }] };
    const first = (await propose(owner, body)).json();
    const again = await propose(owner, body);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ importId: first.importId, alreadyExists: true });
    // …and it is per user: someone else's identical text is their own import.
    const mine = (
      await propose(other, { transactions: [{ ...SELL, description: "idempotent" }] })
    ).json();
    expect(mine.importId).not.toBe(first.importId);
    // A different target depot is a different proposal.
    const otherDepot = (await propose(owner, { transactions: body.transactions })).json();
    expect(otherDepot.importId).not.toBe(first.importId);
  });

  it("defaults the depot to the user's only one", async () => {
    const res = await propose(owner, { transactions: [{ ...SELL, description: "sole depot" }] });
    expect(res.json().portfolioId).toBe(portfolioId);
  });

  it("flags a missing cost basis on an inbound transfer, and confirm refuses it", async () => {
    const res = await propose(owner, {
      portfolioId,
      transactions: [{ ...BUY, action: "transfer_in", price: "0", description: "depot transfer" }],
    });
    const { importId } = res.json();
    const [imp] = await getDb()
      .select()
      .from(screenshotImports)
      .where(eq(screenshotImports.id, importId));
    const drafts = (imp!.parsedJson as { drafts: Record<string, unknown>[] }).drafts;
    expect(drafts[0]!.attention).toEqual(["needs_cost_basis"]);
    const confirm = await app.inject({
      method: "POST",
      url: `/imports/${importId}/confirm`,
      headers: auth(owner),
      payload: { portfolioId, transactions: drafts },
    });
    expect(confirm.statusCode).toBe(400);
    expect(confirm.json().error).toBe("transfer_cost_basis_required");
  });
});

describe("confirming a proposal", () => {
  it("books it as a manual entry, then reports the same proposal as already confirmed", async () => {
    const body = {
      portfolioId,
      transactions: [
        { ...BUY, ticker: "TLKM", name: "Telkom Indonesia", description: "confirm me" },
      ],
    };
    const { importId } = (await propose(owner, body)).json();
    const [imp] = await getDb()
      .select()
      .from(screenshotImports)
      .where(eq(screenshotImports.id, importId));
    const drafts = (imp!.parsedJson as { drafts: unknown[] }).drafts;

    const confirm = await app.inject({
      method: "POST",
      url: `/imports/${importId}/confirm`,
      headers: auth(owner),
      payload: { portfolioId, transactions: drafts },
    });
    expect(confirm.statusCode).toBe(201);
    expect(confirm.json().confirmed).toBe(1);

    const booked = (await rows()).filter((t) => t.source === "manual");
    expect(booked).toHaveLength(1);
    expect(String(booked[0]!.externalId)).toMatch(/^ai:/);

    const again = await propose(owner, body);
    expect(again.json()).toMatchObject({ importId, alreadyConfirmed: true, alreadyExists: false });
  });

  it("flags a cross-source duplicate as a duplicate — never enrichment — and confirm blocks it", async () => {
    const csv = [
      "date,action,assetClass,name,ticker,quantity,unit,price,fees,currency",
      "2026-02-20,buy,equity,Astra International,ASII,50,shares,5000,0,IDR",
    ].join("\n");
    const imp = (
      await app.inject({
        method: "POST",
        url: "/imports/csv",
        headers: auth(owner),
        payload: { content: csv },
      })
    ).json();
    const ok = await app.inject({
      method: "POST",
      url: `/imports/${imp.importId}/confirm`,
      headers: auth(owner),
      payload: { portfolioId, transactions: imp.drafts },
    });
    expect(ok.statusCode).toBe(201);

    const res = await propose(owner, {
      portfolioId,
      transactions: [
        {
          assetClass: "equity",
          action: "buy",
          ticker: "ASII",
          name: "Astra International",
          quantity: "50",
          unit: "shares",
          price: "5000",
          currency: "IDR",
          executedAt: "2026-02-20T00:00:00.000Z",
        },
      ],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().likelyDuplicates).toBe(1);
    const [stored] = await getDb()
      .select()
      .from(screenshotImports)
      .where(eq(screenshotImports.id, res.json().importId));
    const drafts = (
      stored!.parsedJson as { drafts: { likelyDuplicate?: { kind: string; source: string } }[] }
    ).drafts;
    expect(drafts[0]!.likelyDuplicate).toMatchObject({ kind: "duplicate", source: "csv" });

    // The authoritative confirm-time gate agrees: blocked until acknowledged.
    const confirm = await app.inject({
      method: "POST",
      url: `/imports/${res.json().importId}/confirm`,
      headers: auth(owner),
      payload: { portfolioId, transactions: drafts },
    });
    expect(confirm.statusCode).toBe(409);
  });
});

describe("source mapping", () => {
  it("treats an AI proposal as a manual entry that can never enrich another source", () => {
    expect(parserToTxSource("ai")).toBe("manual");
    for (const matched of ["csv", "pdf", "pytr", "ibkr", "manual", "screenshot"]) {
      expect(classifyMatch("ai", matched, false)).toBe("duplicate");
    }
  });
});
