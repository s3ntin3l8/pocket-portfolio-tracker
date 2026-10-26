import { SignJWT, generateKeyPair } from "jose";
import { eq } from "drizzle-orm";
import { Decimal } from "decimal.js";
import { expect } from "vitest";
import { fxRates, instruments, lastPrices, transactions, users } from "@portfolio/db";
import { buildApp } from "../../src/app.js";

// A declarative, fixed-date scenario. Every date is absolute and ids are symbolic, so the
// numbers a ledger produces can be derived by hand and stay valid forever. Expected values
// in a scenario are hand-derived (with the arithmetic in a comment) — never pasted from a
// run of the code under test, which would make the oracle a snapshot.

export type App = Awaited<ReturnType<typeof buildApp>>;

export interface LedgerInstrument {
  symbol: string;
  market: string;
  assetClass: (typeof instruments.$inferInsert)["assetClass"];
  currency: string;
  name: string;
  /**
   * Latest quote, stamped at the ledger's `asOf`: the price cache only trusts a `last_prices`
   * row younger than its TTL, otherwise it asks the (empty, under test) provider and the
   * holding falls back to cost.
   */
  price?: string;
}

export interface LedgerTx {
  portfolio: string;
  type: (typeof transactions.$inferInsert)["type"];
  instrument?: string;
  quantity?: string;
  price?: string;
  fees?: string;
  tax?: string;
  currency: string;
  at: string;
}

export interface Ledger {
  name: string;
  /** The frozen "now" for the whole scenario. */
  asOf: string;
  displayCurrency: string;
  portfolios: Record<string, { name: string; baseCurrency: string; cashCounted: boolean }>;
  instruments: Record<string, LedgerInstrument>;
  fx?: { base: string; quote: string; rate: string; date: string }[];
  transactions: LedgerTx[];
}

export interface LoadedLedger {
  headers: { authorization: string };
  portfolioIds: Record<string, string>;
  instrumentIds: Record<string, string>;
}

const ISSUER = "https://auth.test/application/o/portfolio/";
const AUDIENCE = "portfolio-tracker";

export async function buildIntegrityApp() {
  const kp = await generateKeyPair("ES256");
  process.env.AUTHENTIK_ISSUER = ISSUER;
  process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
  process.env.RATE_LIMIT_MAX = "10000";
  const app = await buildApp({ authKey: kp.publicKey });
  const sign = (sub: string) =>
    new SignJWT({ email: `${sub}@example.com` })
      .setProtectedHeader({ alg: "ES256" })
      .setSubject(sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(kp.privateKey);
  return { app, sign };
}

/** Insert a ledger for a fresh user; the caller must have frozen the clock at `ledger.asOf`. */
export async function loadLedger(
  app: App,
  sign: (sub: string) => Promise<string>,
  ledger: Ledger,
  sub = `ledger-${ledger.name}`,
): Promise<LoadedLedger> {
  const headers = { authorization: `Bearer ${await sign(sub)}` };
  await app.inject({ method: "GET", url: "/me", headers });
  await app.db
    .update(users)
    .set({ displayCurrency: ledger.displayCurrency })
    .where(eq(users.authSub, sub));

  const portfolioIds: Record<string, string> = {};
  for (const [key, p] of Object.entries(ledger.portfolios)) {
    const res = await app.inject({ method: "POST", url: "/portfolios", headers, payload: p });
    expect(res.statusCode, `create portfolio ${key}`).toBe(201);
    portfolioIds[key] = res.json().id as string;
  }

  const instrumentIds: Record<string, string> = {};
  for (const [key, i] of Object.entries(ledger.instruments)) {
    // Global rows: namespace the symbol per ledger so scenarios never collide.
    const [row] = await app.db
      .insert(instruments)
      .values({
        symbol: `${ledger.name}:${i.symbol}`.toUpperCase(),
        market: i.market,
        assetClass: i.assetClass,
        currency: i.currency,
        name: i.name,
      })
      .returning();
    instrumentIds[key] = row!.id;
    if (i.price) {
      await app.db.insert(lastPrices).values({
        instrumentId: row!.id,
        price: i.price,
        currency: i.currency,
        asOf: new Date(ledger.asOf),
      });
    }
  }

  for (const r of ledger.fx ?? []) {
    await app.db.insert(fxRates).values(r).onConflictDoNothing();
  }

  await app.db.insert(transactions).values(
    ledger.transactions.map((t) => ({
      portfolioId: portfolioIds[t.portfolio]!,
      instrumentId: t.instrument ? instrumentIds[t.instrument]! : null,
      type: t.type,
      quantity: t.quantity ?? "0",
      price: t.price ?? "0",
      fees: t.fees ?? "0",
      tax: t.tax ?? null,
      currency: t.currency,
      executedAt: new Date(t.at),
    })),
  );

  return { headers, portfolioIds, instrumentIds };
}

/** Exact decimal comparison (`tol` absolute); money is never compared as a float. */
export function expectDecimal(
  actual: unknown,
  expected: string,
  label: string,
  tol: string = "0",
): void {
  expect(actual, `${label}: missing`).not.toBeNull();
  expect(actual, `${label}: missing`).not.toBeUndefined();
  const diff = new Decimal(String(actual)).sub(expected).abs();
  expect(diff.lte(tol), `${label}: expected ${expected} (±${tol}), got ${String(actual)}`).toBe(
    true,
  );
}
