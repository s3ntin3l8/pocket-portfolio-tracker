import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { portfolios, transactions } from "@portfolio/db";
import { buildApp } from "../../src/app.js";
import { getDb, closeDb } from "../../src/db/client.js";

/**
 * The cash boundary in the transaction list.
 *
 * Cash transactions are always imported — the portfolio's `cashCounted` toggle decides
 * whether they are *counted* (net worth, cash balance, contributions) and whether they are
 * *shown* here. For an invest-only (cash-outside) portfolio the list is the securities
 * ledger, so the pure cash rows are filtered out of the query.
 *
 * The rows themselves are always in the database: every derivation reads them from there
 * directly, never through this route — so the tax, anomaly and summary figures are
 * unaffected by the filter.
 */

const ISSUER = "https://auth.test/o/p/";
const AUDIENCE = "portfolio-tracker";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let privateKey: CryptoKey;

async function token(sub: string) {
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

async function makePortfolio(t: string, name: string, cashCounted: boolean) {
  const res = await app.inject({
    method: "POST",
    url: "/portfolios",
    headers: auth(t),
    payload: { name, baseCurrency: "EUR", cashCounted },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

async function insertTx(opts: { portfolioId: string; type: string; price: string; day?: number }) {
  const [row] = await getDb()
    .insert(transactions)
    .values({
      portfolioId: opts.portfolioId,
      instrumentId: null,
      type: opts.type as never,
      quantity: opts.type === "buy" ? "5" : "0",
      price: opts.price,
      fees: "0",
      currency: "EUR",
      executedAt: new Date(Date.UTC(2026, 0, 1 + (opts.day ?? 0))),
    })
    .returning();
  return row;
}

describe("transaction list — the cash boundary", () => {
  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp({ authKey: kp.publicKey });
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    delete process.env.AUTHENTIK_ISSUER;
    delete process.env.AUTHENTIK_AUDIENCE;
    delete process.env.RATE_LIMIT_MAX;
  });

  beforeEach(async () => {
    await getDb().delete(transactions);
  });

  it("hides the cash rows of an invest-only portfolio and shows them when the toggle is on", async () => {
    const t = await token("cash-boundary-user");
    const pid = await makePortfolio(t, "Invest only", false);
    await insertTx({ portfolioId: pid, type: "buy", price: "100" });
    await insertTx({ portfolioId: pid, type: "deposit", price: "500" });
    await insertTx({ portfolioId: pid, type: "withdrawal", price: "12.5" });

    const hidden = await app.inject({
      method: "GET",
      url: `/portfolios/${pid}/transactions`,
      headers: auth(t),
    });
    expect(hidden.statusCode).toBe(200);
    const body = hidden.json();
    // Only the buy is part of the view.
    expect(body.total).toBe(1);
    expect(body.rows.map((r: { type: string }) => r.type)).toEqual(["buy"]);
    // The rows, the total and the draft count all describe the same filtered set.
    expect(body.draftCount).toBe(0);

    // Flip the boundary: the cash rows are still in the database and now show up.
    await getDb().update(portfolios).set({ cashCounted: true }).where(eq(portfolios.id, pid));

    const shown = await app.inject({
      method: "GET",
      url: `/portfolios/${pid}/transactions`,
      headers: auth(t),
    });
    expect(shown.json().total).toBe(3);
    expect(
      shown
        .json()
        .rows.map((r: { type: string }) => r.type)
        .sort(),
    ).toEqual(["buy", "deposit", "withdrawal"]);
  });

  it("recomputes the list after the toggle flips, even when the list was already cached", async () => {
    const t = await token("cash-boundary-cache-user");
    const pid = await makePortfolio(t, "Invest only cached", false);
    await insertTx({ portfolioId: pid, type: "buy", price: "100" });
    await insertTx({ portfolioId: pid, type: "deposit", price: "500" });

    // Warm the cache with the cash-outside view.
    const before = await app.inject({
      method: "GET",
      url: `/portfolios/${pid}/transactions`,
      headers: auth(t),
    });
    expect(before.json().total).toBe(1);

    await getDb().update(portfolios).set({ cashCounted: true }).where(eq(portfolios.id, pid));

    // The boundary is part of the cache key, so the flip is not served from the cache.
    const after = await app.inject({
      method: "GET",
      url: `/portfolios/${pid}/transactions`,
      headers: auth(t),
    });
    expect(after.json().total).toBe(2);
  });

  it("keeps the hand-authored adjustment and the loan rows visible", async () => {
    const t = await token("cash-boundary-adjustment-user");
    const pid = await makePortfolio(t, "Invest only adjustment", false);
    await insertTx({ portfolioId: pid, type: "buy", price: "100" });
    await insertTx({ portfolioId: pid, type: "deposit", price: "500" });
    await insertTx({ portfolioId: pid, type: "adjustment", price: "25" });
    await insertTx({ portfolioId: pid, type: "loan_drawdown", price: "1000" });

    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${pid}/transactions`,
      headers: auth(t),
    });
    // Only the pure cash movement is hidden: the adjustment and the loan rows stay.
    expect(res.json().total).toBe(3);
    expect(
      res
        .json()
        .rows.map((r: { type: string }) => r.type)
        .sort(),
    ).toEqual(["adjustment", "buy", "loan_drawdown"]);
  });

  it("counts the cash the moment the toggle flips — no re-import, no re-sync", async () => {
    const t = await token("cash-boundary-networth-user");
    const pid = await makePortfolio(t, "Invest only net worth", false);
    await insertTx({ portfolioId: pid, type: "deposit", price: "500" });

    const before = await app.inject({
      method: "GET",
      url: `/portfolios/${pid}/summary`,
      headers: auth(t),
    });
    expect(before.statusCode).toBe(200);
    // Cash outside the boundary: not tracked, not part of the net worth.
    expect(before.json().cashTracked).toBe(false);
    expect(before.json().netWorth).toBe("0");

    await getDb().update(portfolios).set({ cashCounted: true }).where(eq(portfolios.id, pid));

    const after = await app.inject({
      method: "GET",
      url: `/portfolios/${pid}/summary`,
      headers: auth(t),
    });
    // The row was already there — the flip is all it takes.
    expect(after.json().cashTracked).toBe(true);
    expect(after.json().netWorth).toBe("500");
  });

  it("hides each portfolio's cash rows by that portfolio's own boundary in the networth scope", async () => {
    const t = await token("cash-boundary-networth-user");
    const outside = await makePortfolio(t, "Invest only", false);
    const inside = await makePortfolio(t, "Savings", true);
    await insertTx({ portfolioId: outside, type: "buy", price: "100" });
    await insertTx({ portfolioId: outside, type: "deposit", price: "500" });
    await insertTx({ portfolioId: inside, type: "buy", price: "100" });
    await insertTx({ portfolioId: inside, type: "deposit", price: "500" });

    const res = await app.inject({
      method: "GET",
      url: "/networth/transactions",
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().rows as Array<{ type: string; portfolioId: string }>;
    // The invest-only portfolio's deposit is hidden; the savings portfolio's is shown.
    expect(rows.filter((r) => r.type === "deposit").map((r) => r.portfolioId)).toEqual([inside]);
    expect(rows.filter((r) => r.type === "buy")).toHaveLength(2);
  });
});
