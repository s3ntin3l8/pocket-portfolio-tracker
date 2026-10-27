import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { Decimal } from "decimal.js";
import { instruments, transactions } from "@portfolio/db";
import { cashFlow } from "@portfolio/core";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";
import { toCoreTxns } from "../../src/services/tx-core.js";

// Audit B3 + B5: the transaction list's summary "Income" is a SQL CASE that must equal
// Σ cashFlow() over the same confirmed rows. It used to value a lump-sum dividend
// (qty 0, amount in `price` — how every importer books them) at price × 0 = 0, ignore
// fees, and count draft/archived rows.

const ISSUER = "https://auth.test/application/o/portfolio/";
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

const INCOME_AND_TAX = new Set(["dividend", "coupon", "interest", "bonus_cash", "tax"]);

describe("transaction list summary — income parity with cashFlow() (audit B3/B5)", () => {
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

  async function setup(sub: string) {
    const t = await token(sub);
    const portfolioId = (
      await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(t),
        payload: { name: `${sub} book`, baseCurrency: "EUR" },
      })
    ).json().id as string;
    const [inst] = await app.db
      .insert(instruments)
      .values({
        symbol: `PAR${sub.length}${Math.floor(Math.random() * 1e6)}`,
        market: "XETRA",
        assetClass: "equity",
        currency: "EUR",
        name: "Parity Co",
      })
      .returning();
    return { t, portfolioId, instrumentId: inst!.id };
  }

  async function summaryOf(t: string, portfolioId: string) {
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/transactions?page=1&pageSize=25`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    return res.json().summary as { totalInvested: string; totalIncome: string };
  }

  it("equals Σ cashFlow() over the confirmed income/tax rows, incl. a qty-0 dividend", async () => {
    const { t, portfolioId, instrumentId } = await setup("income-parity-user");
    const at = (d: string) => new Date(`2026-03-${d}T10:00:00.000Z`);
    const base = { portfolioId, currency: "EUR" };
    await app.db.insert(transactions).values([
      // The invariant fixture: lump-sum dividend, qty 0, amount in price, with a fee.
      {
        ...base,
        instrumentId,
        type: "dividend",
        quantity: "0",
        price: "123.45",
        fees: "1.5",
        executedAt: at("02"),
      },
      // Per-share dividend (qty > 0) with a fee.
      {
        ...base,
        instrumentId,
        type: "dividend",
        quantity: "10",
        price: "2",
        fees: "0.25",
        executedAt: at("03"),
      },
      {
        ...base,
        instrumentId,
        type: "coupon",
        quantity: "0",
        price: "40",
        fees: "0",
        executedAt: at("04"),
      },
      {
        ...base,
        instrumentId: null,
        type: "interest",
        quantity: "0",
        price: "7.5",
        fees: "0.5",
        executedAt: at("05"),
      },
      {
        ...base,
        instrumentId: null,
        type: "bonus_cash",
        quantity: "0",
        price: "20",
        fees: "0",
        executedAt: at("06"),
      },
      // Standalone tax debit (qty ignored) with a fee.
      {
        ...base,
        instrumentId: null,
        type: "tax",
        quantity: "2",
        price: "10",
        fees: "1",
        executedAt: at("07"),
      },
      // cash_neutral income row: cashFlow() moves only its fees.
      {
        ...base,
        instrumentId,
        type: "dividend",
        quantity: "0",
        price: "999",
        fees: "0.1",
        status: "cash_neutral",
        executedAt: at("08"),
      },
      // Unconfirmed / archived rows must not count (audit B5).
      {
        ...base,
        instrumentId,
        type: "dividend",
        quantity: "0",
        price: "5000",
        fees: "0",
        status: "draft",
        executedAt: at("09"),
      },
      {
        ...base,
        instrumentId,
        type: "dividend",
        quantity: "0",
        price: "7000",
        fees: "0",
        status: "archived",
        executedAt: at("10"),
      },
      // A draft buy must not inflate Invested either.
      {
        ...base,
        instrumentId,
        type: "buy",
        quantity: "1",
        price: "100",
        fees: "0",
        executedAt: at("01"),
      },
      {
        ...base,
        instrumentId,
        type: "buy",
        quantity: "100",
        price: "100",
        fees: "0",
        status: "draft",
        executedAt: at("01"),
      },
    ]);

    const rows = await app.db
      .select()
      .from(transactions)
      .where(eq(transactions.portfolioId, portfolioId));
    const expected = toCoreTxns(rows)
      .filter((tx) => INCOME_AND_TAX.has(tx.type))
      .reduce((s, tx) => s.add(cashFlow(tx)), new Decimal(0));

    const summary = await summaryOf(t, portfolioId);
    expect(new Decimal(summary.totalIncome).toString()).toBe(expected.toString());
    // Spelled out: 121.95 + 19.75 + 40 + 7 + 20 − 11 − 0.1 = 197.6
    expect(summary.totalIncome).toBe("197.6");
    expect(summary.totalInvested).toBe("100");
  });

  it("agrees with the Income page's lifetime on the demo seed shape (qty-0 dividends/coupons, no fees)", async () => {
    const { t, portfolioId, instrumentId } = await setup("income-parity-demo-shape");
    const base = { portfolioId, currency: "EUR", fees: "0" };
    await app.db.insert(transactions).values([
      {
        ...base,
        instrumentId,
        type: "buy",
        quantity: "10",
        price: "50",
        executedAt: new Date("2024-01-02T00:00:00Z"),
      },
      {
        ...base,
        instrumentId,
        type: "dividend",
        quantity: "0",
        price: "150",
        executedAt: new Date("2024-06-01T00:00:00Z"),
      },
      {
        ...base,
        instrumentId,
        type: "dividend",
        quantity: "0",
        price: "240",
        executedAt: new Date("2025-06-01T00:00:00Z"),
      },
      {
        ...base,
        instrumentId,
        type: "coupon",
        quantity: "0",
        price: "41",
        executedAt: new Date("2025-09-01T00:00:00Z"),
      },
      {
        ...base,
        instrumentId: null,
        type: "interest",
        quantity: "0",
        price: "9.4",
        executedAt: new Date("2025-12-31T00:00:00Z"),
      },
    ]);

    const summary = await summaryOf(t, portfolioId);
    const income = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/income`,
      headers: auth(t),
    });
    expect(income.statusCode).toBe(200);
    const body = income.json() as { lifetimeTotal: string; interest: { lifetime: string } };
    // One definition of income (#1167): the Income page's lifetime total is the list summary's
    // figure itself, interest included; the interest line is a subtotal of it, not an addend.
    expect(new Decimal(summary.totalIncome).toString()).toBe(
      new Decimal(body.lifetimeTotal).toString(),
    );
    expect(summary.totalIncome).toBe("440.4");
    expect(body.interest.lifetime).toBe("9.4");
  });
});
