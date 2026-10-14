import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { instruments, prices } from "@portfolio/db";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";

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

/**
 * A DE user with one depot (FSA 1000) holding 10 units of an ETF bought mid-2024 and 5 sold
 * in March 2026. With year-boundary closes 100 / 110 the 2025 estimate is 17.71, deemed
 * received 2 Jan 2026, so the 2026 sell carries a Vorabpauschale credit.
 */
async function setup(
  sub: string,
  symbol: string,
  opts: { withPrices?: boolean; regime?: "ID" } = {},
) {
  const { withPrices = true, regime } = opts;
  const t = await token(sub);
  await app.inject({ method: "GET", url: "/me", headers: auth(t) });
  // Net-worth routes convert into the display currency (default IDR, no EUR→IDR rate here).
  await app.inject({
    method: "PATCH",
    url: "/me",
    headers: auth(t),
    payload: { displayCurrency: "EUR" },
  });
  if (regime) {
    const put = await app.inject({
      method: "PUT",
      url: "/me/preferences",
      headers: auth(t),
      payload: { taxRegime: regime },
    });
    expect(put.statusCode).toBe(200);
  }
  const [fund] = await app.db
    .insert(instruments)
    .values({ symbol, market: "XETRA", assetClass: "etf", currency: "EUR", name: symbol })
    .returning();
  if (withPrices) {
    await app.db.insert(prices).values([
      { instrumentId: fund!.id, date: "2025-01-01", close: "100", currency: "EUR" },
      { instrumentId: fund!.id, date: "2025-12-31", close: "110", currency: "EUR" },
    ]);
  }
  const holder = await app.inject({
    method: "POST",
    url: "/account-holders",
    headers: auth(t),
    payload: { name: "H", type: "self", taxAllowanceAnnual: "1000", taxResidence: "DE" },
  });
  const pf = await app.inject({
    method: "POST",
    url: "/portfolios",
    headers: auth(t),
    payload: {
      name: "P",
      baseCurrency: "EUR",
      cashCounted: false,
      accountHolderId: holder.json().id,
      taxAllowanceAnnual: "1000",
    },
  });
  const portfolioId = pf.json().id as string;
  for (const [type, quantity, price, executedAt] of [
    ["buy", "10", "90", "2024-06-03T00:00:00.000Z"],
    ["sell", "5", "120", "2026-03-10T00:00:00.000Z"],
  ] as const) {
    const res = await app.inject({
      method: "POST",
      url: `/portfolios/${portfolioId}/transactions`,
      headers: auth(t),
      payload: { type, instrumentId: fund!.id, quantity, price, currency: "EUR", executedAt },
    });
    expect(res.statusCode).toBe(201);
  }
  return { t, fund: fund!, portfolioId };
}

type Trade = {
  vorabByYear?: { year: number; amount: string; estimated?: boolean }[];
  legs?: { vorabCredit?: string }[];
};
const creditOf = (trades: Trade[]) =>
  trades.flatMap((tr) => tr.legs ?? []).reduce((sum, l) => sum + Number(l.vorabCredit ?? "0"), 0);

describe("estimated Vorabpauschale across Tax, Trades and Sparplan", () => {
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
    closeDb();
  });

  it("/portfolios/:id/trades carries the estimate and the sell's credit", async () => {
    const { t, portfolioId } = await setup("vsurf-1", "VSURF-A");
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/trades?method=fifo`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const trades = res.json().trades as Trade[];
    const years = trades.flatMap((tr) => tr.vorabByYear ?? []);
    expect(years.some((y) => y.estimated === true)).toBe(true);
    expect(creditOf(trades)).toBeGreaterThan(0);
  });

  it("/networth/trades carries the estimate too", async () => {
    const { t } = await setup("vsurf-2", "VSURF-B");
    const res = await app.inject({
      method: "GET",
      url: "/networth/trades?method=fifo",
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const trades = res.json().trades as Trade[];
    expect(trades.flatMap((tr) => tr.vorabByYear ?? []).some((y) => y.estimated === true)).toBe(
      true,
    );
    expect(creditOf(trades)).toBeGreaterThan(0);
  });

  it("the same sell's Vorab credit matches between Tax and Trades", async () => {
    const { t, portfolioId } = await setup("vsurf-3", "VSURF-C");
    const trades = (
      await app.inject({
        method: "GET",
        url: `/portfolios/${portfolioId}/trades?method=fifo`,
        headers: auth(t),
      })
    ).json().trades as Trade[];
    const credit = creditOf(trades);
    expect(credit).toBeGreaterThan(0);

    const perPortfolio = (
      await app.inject({
        method: "GET",
        url: `/portfolios/${portfolioId}/tax?year=2026`,
        headers: auth(t),
      })
    ).json().allowanceUsage;
    const networth = (
      await app.inject({ method: "GET", url: "/networth/tax?year=2026", headers: auth(t) })
    ).json();
    expect(networth).toHaveLength(1);
    // The tax figure is the credit scaled by the ETF's 30% Teilfreistellung (x0.70).
    const expected = (credit * 0.7).toFixed(2);
    expect(perPortfolio.vorabpauschaleCredited).toBe(expected);
    expect(networth[0].allowanceUsage.vorabpauschaleCredited).toBe(expected);
    expect(networth[0].allowanceUsage.vorabpauschaleEstimated).toBe(true);
    expect(networth[0].allowanceUsage.vorabpauschaleAccrued).toBe(
      perPortfolio.vorabpauschaleAccrued,
    );
  });

  it("without boundary prices the trades carry no estimate", async () => {
    const { t, portfolioId } = await setup("vsurf-4", "VSURF-D", { withPrices: false });
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/trades?method=fifo`,
      headers: auth(t),
    });
    const trades = res.json().trades as Trade[];
    expect(trades.flatMap((tr) => tr.vorabByYear ?? [])).toHaveLength(0);
    expect(creditOf(trades)).toBe(0);
  });

  it("the Indonesian regime gets no estimate on Trades", async () => {
    const { t, portfolioId } = await setup("vsurf-5", "VSURF-E", { regime: "ID" });
    for (const url of [`/portfolios/${portfolioId}/trades?method=fifo`, "/networth/trades"]) {
      const res = await app.inject({ method: "GET", url, headers: auth(t) });
      expect(res.statusCode).toBe(200);
      const trades = res.json().trades as Trade[];
      expect(trades.flatMap((tr) => tr.vorabByYear ?? [])).toHaveLength(0);
      expect(creditOf(trades)).toBe(0);
    }
  });

  it("switching regime does not serve a stale cached trade log", async () => {
    const { t, portfolioId } = await setup("vsurf-6", "VSURF-F");
    const url = `/portfolios/${portfolioId}/trades?method=fifo`;
    const de = (await app.inject({ method: "GET", url, headers: auth(t) })).json().trades;
    expect(creditOf(de)).toBeGreaterThan(0);
    await app.inject({
      method: "PUT",
      url: "/me/preferences",
      headers: auth(t),
      payload: { taxRegime: "ID" },
    });
    const id = (await app.inject({ method: "GET", url, headers: auth(t) })).json().trades;
    expect(creditOf(id)).toBe(0);
  });

  it("/networth/tax gives each portfolio its own estimate from one shared batch", async () => {
    const a = await setup("vsurf-7", "VSURF-G");
    // Second funded depot of the same holder: a different fund, bought a year later (2025), so
    // it has a different first year and different boundary prices.
    const holders = await app.inject({
      method: "GET",
      url: "/account-holders",
      headers: auth(a.t),
    });
    const holderId = holders.json()[0].id as string;
    const [fund2] = await app.db
      .insert(instruments)
      .values({
        symbol: "VSURF-G2",
        market: "XETRA",
        assetClass: "etf",
        currency: "EUR",
        name: "VSURF-G2",
      })
      .returning();
    await app.db.insert(prices).values([
      { instrumentId: fund2!.id, date: "2025-01-01", close: "200", currency: "EUR" },
      { instrumentId: fund2!.id, date: "2025-12-31", close: "220", currency: "EUR" },
    ]);
    const pf2 = await app.inject({
      method: "POST",
      url: "/portfolios",
      headers: auth(a.t),
      payload: {
        name: "P2",
        baseCurrency: "EUR",
        cashCounted: false,
        accountHolderId: holderId,
        taxAllowanceAnnual: "500",
      },
    });
    const buy = await app.inject({
      method: "POST",
      url: `/portfolios/${pf2.json().id}/transactions`,
      headers: auth(a.t),
      payload: {
        type: "buy",
        instrumentId: fund2!.id,
        quantity: "4",
        price: "190",
        currency: "EUR",
        executedAt: "2025-01-02T00:00:00.000Z",
      },
    });
    expect(buy.statusCode).toBe(201);

    // Independent per-portfolio figures.
    const p1 = (
      await app.inject({
        method: "GET",
        url: `/portfolios/${a.portfolioId}/tax?year=2026`,
        headers: auth(a.t),
      })
    ).json().allowanceUsage;
    const p2 = (
      await app.inject({
        method: "GET",
        url: `/portfolios/${pf2.json().id}/tax?year=2026`,
        headers: auth(a.t),
      })
    ).json().allowanceUsage;
    expect(Number(p1.vorabpauschaleAccrued)).toBeGreaterThan(0);
    expect(Number(p2.vorabpauschaleAccrued)).toBeGreaterThan(0);
    expect(p1.vorabpauschaleAccrued).not.toBe(p2.vorabpauschaleAccrued);

    const res = await app.inject({
      method: "GET",
      url: "/networth/tax?year=2026",
      headers: auth(a.t),
    });
    expect(res.statusCode).toBe(200);
    const u = res.json()[0].allowanceUsage;
    // The holder total is the sum of both portfolios' own estimates (each from its own fund
    // and first year), and the 2025-purchase fund's 1/12 purchase-year reduction is included.
    expect(u.vorabpauschaleEstimated).toBe(true);
    expect(u.vorabpauschaleAccrued).toBe(
      (Number(p1.vorabpauschaleAccrued) + Number(p2.vorabpauschaleAccrued)).toFixed(2),
    );
  });
});
