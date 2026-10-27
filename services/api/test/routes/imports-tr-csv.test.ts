import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { buildApp } from "../../src/app.js";
import { like, eq } from "drizzle-orm";
import { instruments, transactions } from "@portfolio/db";
import { closeDb, ensureDb } from "../../src/db/client.js";

const ISSUER = "https://auth.test/o/p/";
const AUDIENCE = "portfolio-tracker";

// A minimal but representative Trade Republic transaction export (sanitised). Covers a
// cash deposit, a stock buy and a foreign dividend with withholding tax + FX.
const HEADER =
  "datetime,date,account_type,category,type,asset_class,name,symbol,shares,price,amount,fee,tax,currency,original_amount,original_currency,fx_rate,description,transaction_id,counterparty_name,counterparty_iban,payment_reference,mcc_code";
const TR_CSV = [
  HEADER,
  '"2023-01-31T22:20:28.617262Z","2023-01-31","DEFAULT","CASH","CUSTOMER_INPAYMENT","","","","","","500.000000","","","EUR","","","","inpayment","00000000-0000-0000-0000-000000000001","","","",""',
  '"2022-08-18T19:17:06.465Z","2022-08-18","DEFAULT","TRADING","BUY","STOCK","Alphabet (C)","US02079K1079","2.0000000000","120.260000","-240.52","-1.00","","EUR","","","","","00000000-0000-0000-0000-000000000002","","","",""',
  '"2025-05-09T01:10:00.000000Z","2025-05-09","DEFAULT","CASH","DIVIDEND","STOCK","Altria Group","US02209S1033","11.0000000000","","3.940000","","-0.59","EUR","3.57","USD","1.103400","","00000000-0000-0000-0000-000000000003","","","",""',
  '"2025-02-03T15:59:12.456716Z","2025-02-03","DEFAULT","CASH","BENEFITS_SAVEBACK","FUND","Core S&amp;P 500 USD (Acc)","IE00B5BMR087","","","0.550000","","","EUR","","","","Your Saveback payment","00000000-0000-0000-0000-000000000004","","","",""',
].join("\n");

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

describe("Trade Republic CSV import path", () => {
  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    app = await buildApp({ authKey: kp.publicKey });
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    delete process.env.AUTHENTIK_ISSUER;
    delete process.env.AUTHENTIK_AUDIENCE;
  });

  it("auto-detects the TR export and round-trips a dividend through confirm with tax + FX", async () => {
    const t = await token("tr-csv-user");
    await app.inject({ method: "GET", url: "/me", headers: auth(t) }); // upsert user
    const portfolioId = (
      await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(t),
        payload: { name: "TR", baseCurrency: "EUR" },
      })
    ).json().id;

    const imp = await app.inject({
      method: "POST",
      url: "/imports/csv",
      headers: auth(t),
      payload: { content: TR_CSV, format: "auto" }, // auto must resolve to tr-csv
    });
    expect(imp.statusCode).toBe(201);
    const { importId, drafts } = imp.json();
    expect(drafts).toHaveLength(4);
    const dividend = drafts.find((d: { action: string }) => d.action === "dividend");
    expect(dividend).toMatchObject({
      price: "3.35",
      total: "3.94",
      tax: "0.59",
      fxRate: "1.103400",
      shares: "11",
    });
    // Saveback is a reward-funded buy, not a contribution → bonus_cash (it would collapse into
    // its funding buy, but this fixture has no Core S&P 500 buy, so it stays a standalone row).
    const saveback = drafts.find((d: { kind?: string }) => d.kind === "bonus");
    expect(saveback).toMatchObject({ action: "bonus_cash", price: "0.55" });

    const confirm = await app.inject({
      method: "POST",
      url: `/imports/${importId}/confirm`,
      headers: auth(t),
      payload: { portfolioId, transactions: drafts },
    });
    expect(confirm.statusCode).toBe(201);

    const list = (
      await app.inject({
        method: "GET",
        url: `/portfolios/${portfolioId}/transactions?all=1`,
        headers: auth(t),
      })
    ).json();
    // A TR account is the mixed-cash case → cash-outside (the default), so the €500
    // deposit is imported but hidden from the transaction list: the boundary decides what
    // is *counted* and *shown*, not what is stored. 4 rows were imported, 3 are visible.
    expect(list).toHaveLength(3);
    expect(list.some((tx: { type: string }) => tx.type === "deposit")).toBe(false);
    const persisted = list.find((tx: { type: string }) => tx.type === "dividend");
    // The EU-broker path resolved the US ISIN to an instrument and persisted the enrichment.
    expect(persisted).toMatchObject({ type: "dividend", tax: "0.59", fxRate: "1.103400" });
    expect(persisted.instrumentId).toBeTruthy();
    // #508: `shares` is carried through the fresh-insert confirm path (materialize-drafts.ts),
    // not left to the settlement-PDF-only enrichment pass — a standalone CSV dividend has no
    // PDF to enrich against.
    expect(persisted.shares).toBe("11");

    // Contribution is the invested capital: the €241.52 buy (2 × 120.26 + €1 fee). The
    // €500 deposit never entered the portfolio (cash outside the boundary), and the
    // saveback (now `bonus_cash`) and the dividend are income — neither inflates the
    // contributed total.
    const contrib = (
      await app.inject({
        method: "GET",
        url: `/portfolios/${portfolioId}/contributions`,
        headers: auth(t),
      })
    ).json();
    expect(contrib.totalContributed).toBe("241.52");
  });

  it("books a Vorabpauschale (EARNINGS) row as a tax transaction with no instrument", async () => {
    const t = await token("tr-csv-vorab-user");
    await app.inject({ method: "GET", url: "/me", headers: auth(t) });
    const portfolioId = (
      await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(t),
        payload: { name: "TR Vorab", baseCurrency: "EUR" },
      })
    ).json().id;
    const csv = [
      HEADER,
      '"2026-01-28T07:42:17.274Z","2026-01-28","DEFAULT","CASH","EARNINGS","FUND","","","","","0.000000","","-1.37","EUR","","","","Vorabpauschale for ISIN IE00BK5BQT80","00000000-0000-0000-0000-000000000009","","","",""',
    ].join("\n");

    const imp = await app.inject({
      method: "POST",
      url: "/imports/csv",
      headers: auth(t),
      payload: { content: csv, format: "auto" },
    });
    expect(imp.statusCode).toBe(201);
    const { importId, drafts } = imp.json();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ action: "tax" });

    const confirm = await app.inject({
      method: "POST",
      url: `/imports/${importId}/confirm`,
      headers: auth(t),
      payload: { portfolioId, transactions: drafts },
    });
    expect(confirm.statusCode).toBe(201);

    const db = await ensureDb();
    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.portfolioId, portfolioId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "tax", instrumentId: null, price: "1.37" });
    // No tradable instrument is created from the row's label.
    expect(
      await db.select().from(instruments).where(like(instruments.symbol, "Vorabpauschale%")),
    ).toEqual([]);
  });

  const vorabCsv = (isin: string, txId: string) =>
    [
      HEADER,
      `"2026-01-28T07:42:17.274Z","2026-01-28","DEFAULT","CASH","EARNINGS","FUND","","","","","0.000000","","-1.37","EUR","","","","Vorabpauschale for ISIN ${isin}","${txId}","","","",""`,
    ].join("\n");

  async function importVorab(
    sub: string,
    isin: string,
    seed?: (portfolioId: string) => Promise<void>,
  ) {
    const t = await token(sub);
    await app.inject({ method: "GET", url: "/me", headers: auth(t) });
    const portfolioId = (
      await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(t),
        payload: { name: `TR ${sub}`, baseCurrency: "EUR" },
      })
    ).json().id as string;
    await seed?.(portfolioId);
    const imp = await app.inject({
      method: "POST",
      url: "/imports/csv",
      headers: auth(t),
      payload: {
        content: vorabCsv(isin, `00000000-0000-0000-0000-0000000000${sub.length}9`),
        format: "auto",
      },
    });
    const { importId, drafts } = imp.json();
    expect(drafts[0]).toMatchObject({ action: "tax", isin, kind: "vorabpauschale" });
    const confirm = await app.inject({
      method: "POST",
      url: `/imports/${importId}/confirm`,
      headers: auth(t),
      payload: { portfolioId, transactions: drafts },
    });
    expect(confirm.statusCode).toBe(201);
    const db = await ensureDb();
    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.portfolioId, portfolioId));
    return { db, portfolioId, rows };
  }

  async function seedFund(isin: string, symbol: string) {
    const db = await ensureDb();
    const [inst] = await db
      .insert(instruments)
      .values({ symbol, market: "XETRA", assetClass: "etf", currency: "EUR", name: symbol, isin })
      .returning();
    return inst!;
  }

  it("links a Vorabpauschale row to a fund the portfolio already trades, creating nothing", async () => {
    const isin = "IE00B3RBWM25";
    const inst = await seedFund(isin, "VORABHELD");
    const { db, rows } = await importVorab("tr-csv-vorab-held", isin, async (portfolioId) => {
      await db_insertBuy(portfolioId, inst.id);
    });
    expect(rows.filter((r) => r.type === "tax")).toHaveLength(1);
    expect(rows.find((r) => r.type === "tax")).toMatchObject({
      instrumentId: inst.id,
      kind: "vorabpauschale",
      price: "1.37",
    });
    expect(await db.select().from(instruments).where(eq(instruments.isin, isin))).toHaveLength(1);
  });

  it("does not link to a fund that only exists for another portfolio", async () => {
    const isin = "IE00B4L5Y983";
    await seedFund(isin, "VORABOTHER");
    const { rows } = await importVorab("tr-csv-vorab-other", isin);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "tax", instrumentId: null });
  });

  async function db_insertBuy(portfolioId: string, instrumentId: string) {
    const db = await ensureDb();
    await db.insert(transactions).values({
      portfolioId,
      instrumentId,
      type: "buy",
      quantity: "1",
      price: "100",
      fees: "0",
      currency: "EUR",
      executedAt: new Date("2025-06-01T10:00:00.000Z"),
    });
  }
});
