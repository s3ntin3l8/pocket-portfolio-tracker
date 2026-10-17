import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import {
  benchmarkPrices,
  corporateActions,
  fxRates,
  instruments,
  portfolioSnapshots,
  portfolios,
  prices,
  transactions,
  users,
} from "@portfolio/db";
import { eq, sql } from "drizzle-orm";
import { buildApp } from "../../src/app.js";
import {
  loadBoundaryFlowsForUser,
  yearEndNavs,
} from "../../src/routes/transactions/insights/yearly-returns.js";
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

describe("GET /insights", () => {
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

  // Regression guard: drawdown must come from the cashflow-normalized TWR index
  // (marketValue/effectiveFlow), not raw snapshot net worth. A withdrawal shrinks net
  // worth (cash leaving the portfolio) without touching holdings market value at all —
  // feeding raw net worth into maxDrawdown manufactures a phantom drawdown for what is
  // just money leaving the boundary, not a loss.
  it("does not report a phantom drawdown from a net-worth-only withdrawal", async () => {
    const t = await token("insights-drawdown-user");
    const create = await app.inject({
      method: "POST",
      url: "/portfolios",
      headers: auth(t),
      payload: { name: "Drawdown Test", baseCurrency: "IDR" },
    });
    const portfolioId = create.json().id;

    // marketValue and effectiveFlow are flat across all three days (nothing bought,
    // sold, or otherwise flowed through holdings) — only netWorth (which includes
    // cash) drops sharply on day 2, as a large cash withdrawal would.
    await app.db.insert(portfolioSnapshots).values([
      {
        portfolioId,
        date: "2026-01-01",
        netWorth: "1000000",
        marketValue: "1000000",
        effectiveFlow: "0",
        currency: "IDR",
      },
      {
        portfolioId,
        date: "2026-01-02",
        netWorth: "200000",
        marketValue: "1000000",
        effectiveFlow: "0",
        currency: "IDR",
      },
      {
        portfolioId,
        date: "2026-01-03",
        netWorth: "1000000",
        marketValue: "1000000",
        effectiveFlow: "0",
        currency: "IDR",
      },
    ]);

    const res = await app.inject({ method: "GET", url: "/insights?range=all", headers: auth(t) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Number(body.drawdown.maxDrawdownPct)).toBeCloseTo(0, 6);
  });

  // Regression guard for the portfolio selector not reacting (#insights scope bug):
  // /insights must accept ?portfolioId= and scope every metric to that one portfolio,
  // not always aggregate across the user's whole account.
  it("scopes metrics to a single portfolio via ?portfolioId=, distinct from the aggregate", async () => {
    const t = await token("insights-scope-user");
    const mk = async (name: string) =>
      (
        await app.inject({
          method: "POST",
          url: "/portfolios",
          headers: auth(t),
          payload: { name, baseCurrency: "IDR" },
        })
      ).json().id;
    const flatId = await mk("Flat");
    const crashId = await mk("Crash");

    await app.db.insert(portfolioSnapshots).values([
      {
        portfolioId: flatId,
        date: "2026-01-01",
        netWorth: "1000000",
        marketValue: "1000000",
        effectiveFlow: "0",
        currency: "IDR",
      },
      {
        portfolioId: flatId,
        date: "2026-01-02",
        netWorth: "1000000",
        marketValue: "1000000",
        effectiveFlow: "0",
        currency: "IDR",
      },
      // A real holdings crash: marketValue halves with no offsetting effectiveFlow.
      {
        portfolioId: crashId,
        date: "2026-01-01",
        netWorth: "1000000",
        marketValue: "1000000",
        effectiveFlow: "0",
        currency: "IDR",
      },
      {
        portfolioId: crashId,
        date: "2026-01-02",
        netWorth: "500000",
        marketValue: "500000",
        effectiveFlow: "0",
        currency: "IDR",
      },
    ]);

    const flat = await app.inject({
      method: "GET",
      url: `/insights?range=all&portfolioId=${flatId}`,
      headers: auth(t),
    });
    const crash = await app.inject({
      method: "GET",
      url: `/insights?range=all&portfolioId=${crashId}`,
      headers: auth(t),
    });
    const aggregate = await app.inject({
      method: "GET",
      url: "/insights?range=all",
      headers: auth(t),
    });

    expect(Number(flat.json().drawdown.maxDrawdownPct)).toBeCloseTo(0, 6);
    expect(Number(crash.json().drawdown.maxDrawdownPct)).toBeCloseTo(-0.5, 6);
    // The aggregate blends both portfolios, so it lands strictly between the two —
    // proving portfolioId genuinely filters rather than being ignored.
    const aggDd = Number(aggregate.json().drawdown.maxDrawdownPct);
    expect(aggDd).toBeLessThan(0);
    expect(aggDd).toBeGreaterThan(-0.5);

    // A portfolio owned by someone else must not be selectable.
    const other = await token("insights-scope-other-user");
    const cross = await app.inject({
      method: "GET",
      url: `/insights?portfolioId=${flatId}`,
      headers: auth(other),
    });
    expect(cross.statusCode).toBe(200);
    expect(cross.json().drawdown.maxDrawdownPct).toBe("0");
  });

  // Regression guard: a stale/missing price for a still-held instrument gets recorded
  // upstream (snapshot generation) as marketValue=0 with no offsetting effectiveFlow —
  // a data artifact, not a real total loss. Before the chainIndex guard, this single
  // gap day permanently zeroed the TWR index, so drawdown read -100% "from the
  // beginning" no matter how healthy the portfolio actually was on every other day.
  it("does not report -100% drawdown from a single price-gap snapshot day", async () => {
    const t = await token("insights-gap-user");
    const create = await app.inject({
      method: "POST",
      url: "/portfolios",
      headers: auth(t),
      payload: { name: "Gap Test", baseCurrency: "IDR" },
    });
    const portfolioId = create.json().id;

    await app.db.insert(portfolioSnapshots).values([
      {
        portfolioId,
        date: "2026-01-01",
        netWorth: "1000000",
        marketValue: "1000000",
        effectiveFlow: "1000000",
        currency: "IDR",
      },
      {
        portfolioId,
        date: "2026-01-02",
        netWorth: "1100000",
        marketValue: "1100000",
        effectiveFlow: "0",
        currency: "IDR",
      },
      // Gap day: price missing for the held instrument → marketValue recorded as 0,
      // no compensating flow.
      {
        portfolioId,
        date: "2026-01-03",
        netWorth: "0",
        marketValue: "0",
        effectiveFlow: "0",
        currency: "IDR",
      },
      {
        portfolioId,
        date: "2026-01-04",
        netWorth: "1150000",
        marketValue: "1150000",
        effectiveFlow: "0",
        currency: "IDR",
      },
    ]);

    const res = await app.inject({ method: "GET", url: "/insights?range=all", headers: auth(t) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Must NOT be -1 (-100%) — the gap day is carried forward, not applied as a real loss.
    expect(Number(body.drawdown.maxDrawdownPct)).not.toBeCloseTo(-1, 2);
    expect(Number(body.drawdown.maxDrawdownPct)).toBeGreaterThan(-0.5);
  });

  describe("period best/worst", () => {
    it("returns MTD and YTD best/worst from price moves of continuously-held instruments", async () => {
      const t = await token("insights-period-user");
      const create = await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(t),
        payload: { name: "Period Test", baseCurrency: "IDR" },
      });
      const portfolioId = create.json().id;

      const [instA] = await app.db
        .insert(instruments)
        .values({
          symbol: "INSTA",
          name: "Instrument A",
          assetClass: "equity",
          unit: "shares",
          market: "IDX",
          sector: null,
          currency: "IDR",
        })
        .returning({ id: instruments.id });
      const [instB] = await app.db
        .insert(instruments)
        .values({
          symbol: "INSTB",
          name: "Instrument B",
          assetClass: "equity",
          unit: "shares",
          market: "IDX",
          sector: null,
          currency: "IDR",
        })
        .returning({ id: instruments.id });

      // Both bought before Jan 2026 — held at period start (Jan 1) → qualifies as continuously-held.
      await app.db.insert(transactions).values({
        portfolioId,
        instrumentId: instA.id,
        type: "buy",
        quantity: "10",
        price: "100",
        currency: "IDR",
        executedAt: new Date("2025-12-15"),
      });
      await app.db.insert(transactions).values({
        portfolioId,
        instrumentId: instB.id,
        type: "buy",
        quantity: "20",
        price: "50",
        currency: "IDR",
        executedAt: new Date("2025-12-15"),
      });

      // Prices at period start and period end: A goes up 50%, B goes down 40%.
      await app.db.insert(prices).values([
        { instrumentId: instA.id, date: "2025-12-15", close: "100", currency: "IDR" },
        { instrumentId: instA.id, date: "2026-01-31", close: "150", currency: "IDR" },
        { instrumentId: instB.id, date: "2025-12-15", close: "50", currency: "IDR" },
        { instrumentId: instB.id, date: "2026-01-31", close: "30", currency: "IDR" },
      ]);

      await app.db.insert(portfolioSnapshots).values([
        {
          portfolioId,
          date: "2026-01-01",
          netWorth: "2000",
          marketValue: "2000",
          effectiveFlow: "2000",
          currency: "IDR",
        },
        {
          portfolioId,
          date: "2026-01-15",
          netWorth: "2100",
          marketValue: "2100",
          effectiveFlow: "0",
          currency: "IDR",
        },
        {
          portfolioId,
          date: "2026-01-31",
          netWorth: "2100",
          marketValue: "2100",
          effectiveFlow: "0",
          currency: "IDR",
        },
      ]);

      const res = await app.inject({ method: "GET", url: "/insights?range=all", headers: auth(t) });
      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.bestWorstMonthly.best).not.toBeNull();
      expect(body.bestWorstMonthly.best.instrumentId).toBe(instA.id);
      expect(body.bestWorstMonthly.best.pct).toBeCloseTo(0.5, 6);
      expect(body.bestWorstMonthly.worst.instrumentId).toBe(instB.id);
      expect(body.bestWorstMonthly.worst.pct).toBeCloseTo(-0.4, 6);

      // Yearly overlaps the same month — same prices → same result.
      expect(body.bestWorstYearly.best).not.toBeNull();
      expect(body.bestWorstYearly.best.instrumentId).toBe(instA.id);
      expect(body.bestWorstYearly.best.pct).toBeCloseTo(0.5, 6);
      expect(body.bestWorstYearly.worst.instrumentId).toBe(instB.id);
      expect(body.bestWorstYearly.worst.pct).toBeCloseTo(-0.4, 6);
    });

    // Regression guard: a tie among FRESHLY priced movers is a genuine (if unlikely)
    // result, not a data problem — it must not be mislabeled `reason: "stale_prices"`,
    // which would tell the user something is wrong with their price feed when nothing is.
    it("returns null best/worst with no reason when fresh-priced movers genuinely tie", async () => {
      const t = await token("insights-genuine-tie-user");
      const create = await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(t),
        payload: { name: "Tie Test", baseCurrency: "IDR" },
      });
      const portfolioId = create.json().id;

      const [instA] = await app.db
        .insert(instruments)
        .values({
          symbol: "TIEA",
          name: "Instrument A",
          assetClass: "equity",
          unit: "shares",
          market: "IDX",
          sector: null,
          currency: "IDR",
        })
        .returning({ id: instruments.id });
      const [instB] = await app.db
        .insert(instruments)
        .values({
          symbol: "TIEB",
          name: "Instrument B",
          assetClass: "equity",
          unit: "shares",
          market: "IDX",
          sector: null,
          currency: "IDR",
        })
        .returning({ id: instruments.id });

      await app.db.insert(transactions).values([
        {
          portfolioId,
          instrumentId: instA.id,
          type: "buy",
          quantity: "10",
          price: "100",
          currency: "IDR",
          executedAt: new Date("2025-12-15"),
        },
        {
          portfolioId,
          instrumentId: instB.id,
          type: "buy",
          quantity: "20",
          price: "50",
          currency: "IDR",
          executedAt: new Date("2025-12-15"),
        },
      ]);

      // Both instruments move by the exact same +50%, both freshly priced at period end.
      await app.db.insert(prices).values([
        { instrumentId: instA.id, date: "2025-12-15", close: "100", currency: "IDR" },
        { instrumentId: instA.id, date: "2026-01-31", close: "150", currency: "IDR" },
        { instrumentId: instB.id, date: "2025-12-15", close: "50", currency: "IDR" },
        { instrumentId: instB.id, date: "2026-01-31", close: "75", currency: "IDR" },
      ]);

      await app.db.insert(portfolioSnapshots).values([
        {
          portfolioId,
          date: "2026-01-01",
          netWorth: "2000",
          marketValue: "2000",
          effectiveFlow: "2000",
          currency: "IDR",
        },
        {
          portfolioId,
          date: "2026-01-31",
          netWorth: "2500",
          marketValue: "2500",
          effectiveFlow: "0",
          currency: "IDR",
        },
      ]);

      const res = await app.inject({ method: "GET", url: "/insights?range=all", headers: auth(t) });
      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.bestWorstMonthly.best).toBeNull();
      expect(body.bestWorstMonthly.worst).toBeNull();
      expect(body.bestWorstMonthly.reason).toBeNull();
    });

    it("split-adjusts period returns so a 2:1 split doesn't look like -50%", async () => {
      const t = await token("insights-split-user");
      const create = await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(t),
        payload: { name: "Split Test", baseCurrency: "IDR" },
      });
      const portfolioId = create.json().id;

      // Two instruments held before and during Jan 2026.
      const [instA] = await app.db
        .insert(instruments)
        .values({
          symbol: "SPLIT",
          name: "Split Co",
          assetClass: "equity",
          unit: "shares",
          market: "IDX",
          sector: null,
          currency: "IDR",
        })
        .returning({ id: instruments.id });
      const [instB] = await app.db
        .insert(instruments)
        .values({
          symbol: "NORMAL",
          name: "Normal Co",
          assetClass: "equity",
          unit: "shares",
          market: "IDX",
          sector: null,
          currency: "IDR",
        })
        .returning({ id: instruments.id });

      await app.db.insert(transactions).values({
        portfolioId,
        instrumentId: instA.id,
        type: "buy",
        quantity: "10",
        price: "100",
        currency: "IDR",
        executedAt: new Date("2025-12-15"),
      });
      await app.db.insert(transactions).values({
        portfolioId,
        instrumentId: instB.id,
        type: "buy",
        quantity: "10",
        price: "50",
        currency: "IDR",
        executedAt: new Date("2025-12-15"),
      });

      // Inst A has a 2:1 split on Jan 15 — raw close on Jan 31 is half the start.
      await app.db.insert(corporateActions).values({
        instrumentId: instA.id,
        type: "split",
        ratio: "2",
        exDate: "2026-01-15",
      });

      await app.db.insert(prices).values([
        { instrumentId: instA.id, date: "2025-12-15", close: "100", currency: "IDR" },
        // Raw close after split is exactly half — no real gain/loss after adjustment.
        { instrumentId: instA.id, date: "2026-01-31", close: "50", currency: "IDR" },
        { instrumentId: instB.id, date: "2025-12-15", close: "50", currency: "IDR" },
        { instrumentId: instB.id, date: "2026-01-31", close: "75", currency: "IDR" },
      ]);

      await app.db.insert(portfolioSnapshots).values([
        {
          portfolioId,
          date: "2026-01-01",
          netWorth: "1500",
          marketValue: "1500",
          effectiveFlow: "1500",
          currency: "IDR",
        },
        {
          portfolioId,
          date: "2026-01-15",
          netWorth: "1500",
          marketValue: "1500",
          effectiveFlow: "0",
          currency: "IDR",
        },
        {
          portfolioId,
          date: "2026-01-31",
          netWorth: "1250",
          marketValue: "1250",
          effectiveFlow: "0",
          currency: "IDR",
        },
      ]);

      const res = await app.inject({ method: "GET", url: "/insights?range=all", headers: auth(t) });
      expect(res.statusCode).toBe(200);
      const body = res.json();

      // Split-adjusted: A = (50/1) / (100/2) - 1 = 50/50 - 1 = 0%
      // B = 75/50 - 1 = +50%
      // Best = B (+50%), worst = A (0%)
      expect(body.bestWorstMonthly.best).not.toBeNull();
      expect(body.bestWorstMonthly.best.instrumentId).toBe(instB.id);
      expect(body.bestWorstMonthly.best.pct).toBeCloseTo(0.5, 6);
      expect(body.bestWorstMonthly.worst.instrumentId).toBe(instA.id);
      expect(body.bestWorstMonthly.worst.pct).toBeCloseTo(0, 6);
    });

    it("returns null for both best/worst when fewer than 2 held instruments have a period-start price", async () => {
      const t = await token("insights-period-user-edge");
      const create = await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(t),
        payload: { name: "Period Edge", baseCurrency: "IDR" },
      });
      const portfolioId = create.json().id;

      // Only one instrument — no best/worst pair possible.
      const [inst] = await app.db
        .insert(instruments)
        .values({
          symbol: "ONLY",
          name: "Only One",
          assetClass: "equity",
          unit: "shares",
          market: "IDX",
          sector: null,
          currency: "IDR",
        })
        .returning({ id: instruments.id });

      await app.db.insert(transactions).values({
        portfolioId,
        instrumentId: inst.id,
        type: "buy",
        quantity: "10",
        price: "100",
        currency: "IDR",
        executedAt: new Date("2026-01-02"),
      });

      await app.db.insert(prices).values([
        { instrumentId: inst.id, date: "2026-01-01", close: "100", currency: "IDR" },
        { instrumentId: inst.id, date: "2026-01-31", close: "110", currency: "IDR" },
      ]);

      await app.db.insert(portfolioSnapshots).values([
        {
          portfolioId,
          date: "2026-01-01",
          netWorth: "1000",
          marketValue: "1000",
          effectiveFlow: "1000",
          currency: "IDR",
        },
        {
          portfolioId,
          date: "2026-01-31",
          netWorth: "1100",
          marketValue: "1100",
          effectiveFlow: "0",
          currency: "IDR",
        },
      ]);

      const res = await app.inject({ method: "GET", url: "/insights?range=all", headers: auth(t) });
      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.bestWorstMonthly.best).toBeNull();
      expect(body.bestWorstMonthly.worst).toBeNull();
      expect(body.bestWorstYearly.best).toBeNull();
      expect(body.bestWorstYearly.worst).toBeNull();
    });

    // Regression guard for the reported anomaly: two positions whose price feed
    // stopped updating weeks ago must NOT be reported as "best" and "worst" at a
    // fabricated 0.00% (start price === end price only because both resolve to the
    // same frozen carry-forward) while a position with genuinely fresh data exists.
    it("excludes instruments whose price hasn't updated in weeks from best/worst, rather than reporting a frozen 0.00%", async () => {
      const t = await token("insights-stale-price-user");
      const create = await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(t),
        payload: { name: "Stale Price Test", baseCurrency: "IDR" },
      });
      const portfolioId = create.json().id;

      const [stale1] = await app.db
        .insert(instruments)
        .values({
          symbol: "STALE1",
          name: "Stale One",
          assetClass: "equity",
          unit: "shares",
          market: "IDX",
          sector: null,
          currency: "IDR",
        })
        .returning({ id: instruments.id });
      const [stale2] = await app.db
        .insert(instruments)
        .values({
          symbol: "STALE2",
          name: "Stale Two",
          assetClass: "equity",
          unit: "shares",
          market: "IDX",
          sector: null,
          currency: "IDR",
        })
        .returning({ id: instruments.id });
      const [fresh] = await app.db
        .insert(instruments)
        .values({
          symbol: "FRESH",
          name: "Fresh One",
          assetClass: "equity",
          unit: "shares",
          market: "IDX",
          sector: null,
          currency: "IDR",
        })
        .returning({ id: instruments.id });

      for (const inst of [stale1, stale2, fresh]) {
        await app.db.insert(transactions).values({
          portfolioId,
          instrumentId: inst.id,
          type: "buy",
          quantity: "10",
          price: "100",
          currency: "IDR",
          executedAt: new Date("2025-12-01"),
        });
      }

      // stale1/stale2: last price update is 2025-12-01 — 76 days before the "as of
      // now" date below, far past MAX_PRICE_CARRY_FORWARD_DAYS. Both would resolve
      // to the SAME frozen close for both the period-start and period-end lookup,
      // i.e. an identical, fabricated 0.00% move under the old (ungated) behaviour.
      await app.db.insert(prices).values([
        { instrumentId: stale1.id, date: "2025-12-01", close: "100", currency: "IDR" },
        { instrumentId: stale2.id, date: "2025-12-01", close: "50", currency: "IDR" },
        // fresh: a real move, with an up-to-date price right at period end.
        { instrumentId: fresh.id, date: "2026-02-01", close: "100", currency: "IDR" },
        { instrumentId: fresh.id, date: "2026-02-14", close: "95", currency: "IDR" },
      ]);

      await app.db.insert(portfolioSnapshots).values([
        {
          portfolioId,
          date: "2026-02-01",
          netWorth: "3000",
          marketValue: "3000",
          effectiveFlow: "3000",
          currency: "IDR",
        },
        {
          portfolioId,
          date: "2026-02-15",
          netWorth: "2950",
          marketValue: "2950",
          effectiveFlow: "0",
          currency: "IDR",
        },
      ]);

      const res = await app.inject({ method: "GET", url: "/insights?range=all", headers: auth(t) });
      expect(res.statusCode).toBe(200);
      const body = res.json();

      // Only one instrument (fresh) has current-enough data — fewer than 2 qualifying
      // movers means the card is correctly suppressed rather than pairing two stale
      // 0.00% instruments as "best" and "worst". The reason is surfaced so the UI can
      // say why, rather than the card silently vanishing with no explanation.
      expect(body.bestWorstMonthly.best).toBeNull();
      expect(body.bestWorstMonthly.worst).toBeNull();
      expect(body.bestWorstMonthly.reason).toBe("stale_prices");
    });
  });

  describe("per-year XIRR", () => {
    // Regression guard for the reported anomaly: a portfolio already worth 30000 on
    // Jan 1 that takes a 2000 deposit and ends the year at 36000 is a modest real
    // return (~13%), not the >250% XIRR produced when the opening NAV is omitted
    // from the cash-flow vector (the year's flows alone — a single -2000 outflow
    // against a +36000 terminal inflow — would solve for an absurd rate).
    it("seeds the year's XIRR with the PRIOR year's closing NAV as an opening outflow", async () => {
      const t = await token("insights-yearly-xirr-user");
      const create = await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(t),
        payload: { name: "Yearly XIRR Test", baseCurrency: "IDR", cashCounted: true },
      });
      const portfolioId = create.json().id;

      // 2025: a single snapshot establishes the prior year's closing NAV (30000).
      await app.db.insert(portfolioSnapshots).values({
        portfolioId,
        date: "2025-12-31",
        netWorth: "30000",
        marketValue: "30000",
        effectiveFlow: "30000",
        currency: "IDR",
      });

      // 2026: a 2000 deposit, ending the year at 36000.
      await app.db.insert(transactions).values({
        portfolioId,
        type: "deposit",
        price: "2000",
        currency: "IDR",
        executedAt: new Date("2026-06-15"),
      });
      await app.db.insert(portfolioSnapshots).values({
        portfolioId,
        date: "2026-12-31",
        netWorth: "36000",
        marketValue: "36000",
        effectiveFlow: "6000",
        currency: "IDR",
      });

      const res = await app.inject({ method: "GET", url: "/insights?range=all", headers: auth(t) });
      expect(res.statusCode).toBe(200);
      const body = res.json();

      const row2026 = body.yearlyReturns.find((r: { year: number }) => r.year === 2026);
      expect(row2026).toBeTruthy();
      expect(row2026.portfolioXirr).not.toBeNull();
      const xirr = Number(row2026.portfolioXirr);
      // A real ~13% year, not the 250%+ the missing opening NAV used to produce.
      expect(xirr).toBeGreaterThan(0);
      expect(xirr).toBeLessThan(0.5);
    });

    // Regression guard for issue #736's `status` fix: loadBoundaryFlowsForUser's select
    // used to omit `status`, so archived/draft rows arrived in core with `status:
    // undefined` and slipped past every guard that checks for it — silently counting a
    // huge archived deposit as a real cash flow into the per-year XIRR.
    it("excludes an archived deposit from the year's XIRR flows", async () => {
      const t = await token("insights-yearly-xirr-archived-user");
      const create = await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(t),
        payload: { name: "Archived Flow Test", baseCurrency: "IDR", cashCounted: true },
      });
      const portfolioId = create.json().id;

      await app.db.insert(portfolioSnapshots).values({
        portfolioId,
        date: "2025-12-31",
        netWorth: "30000",
        marketValue: "30000",
        effectiveFlow: "30000",
        currency: "IDR",
      });

      await app.db.insert(transactions).values([
        {
          portfolioId,
          type: "deposit",
          price: "2000",
          currency: "IDR",
          executedAt: new Date("2026-06-15"),
        },
        // A huge archived deposit — must NOT count as a real cash flow. Before the
        // `status` fix, this would have solved for an absurd XIRR instead of the
        // ~13% real return the same-shaped non-archived test above expects.
        {
          portfolioId,
          type: "deposit",
          price: "5000000",
          currency: "IDR",
          executedAt: new Date("2026-07-01"),
          status: "archived",
        },
      ]);
      await app.db.insert(portfolioSnapshots).values({
        portfolioId,
        date: "2026-12-31",
        netWorth: "36000",
        marketValue: "36000",
        effectiveFlow: "6000",
        currency: "IDR",
      });

      const res = await app.inject({ method: "GET", url: "/insights?range=all", headers: auth(t) });
      expect(res.statusCode).toBe(200);
      const body = res.json();

      const row2026 = body.yearlyReturns.find((r: { year: number }) => r.year === 2026);
      expect(row2026).toBeTruthy();
      expect(row2026.portfolioXirr).not.toBeNull();
      const xirr = Number(row2026.portfolioXirr);
      // Same real ~13% year as the non-archived case — the archived 5,000,000 deposit
      // must not move this number at all.
      expect(xirr).toBeGreaterThan(0);
      expect(xirr).toBeLessThan(0.5);
    });

    // Audit B13: the yearly XIRR's flow loader omitted the `tax` column, so
    // `cashFlow(sell)` (proceeds − fees − tax) saw tax = 0 and every taxed sale entered
    // the per-year XIRR at its GROSS proceeds — more cash than the user ever received.
    it("nets withheld tax out of an outside-boundary sell flow", async () => {
      const t = await token("insights-yearly-xirr-tax-user");
      const create = await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(t),
        payload: { name: "Taxed Sell Test", baseCurrency: "EUR", cashCounted: false },
      });
      const portfolioId = create.json().id;
      const [pf] = await app.db
        .select({ userId: portfolios.userId })
        .from(portfolios)
        .where(eq(portfolios.id, portfolioId));
      const [inst] = await app.db
        .insert(instruments)
        .values({
          symbol: "TAXSELL",
          name: "Taxed Sell Co",
          assetClass: "equity",
          unit: "shares",
          market: "XETRA",
          currency: "EUR",
        })
        .returning();
      await app.db.insert(transactions).values([
        {
          portfolioId,
          instrumentId: inst!.id,
          type: "buy",
          quantity: "10",
          price: "100",
          fees: "1",
          currency: "EUR",
          executedAt: new Date("2026-01-10"),
        },
        {
          portfolioId,
          instrumentId: inst!.id,
          type: "sell",
          quantity: "10",
          price: "150",
          fees: "1",
          tax: "131.88",
          currency: "EUR",
          executedAt: new Date("2026-06-10"),
        },
      ]);

      const flows = await loadBoundaryFlowsForUser(
        app,
        pf!.userId,
        [portfolioId],
        "EUR",
        "outside",
      );
      const sell = flows.find((f) => f.date.toISOString().startsWith("2026-06-10"));
      expect(sell).toBeTruthy();
      // 10 × 150 − 1 fee − 131.88 tax = 1367.12 (pre-fix: 1499, the gross proceeds).
      expect(sell!.amount).toBe("1367.12");
    });
  });

  // Issue #1020: the per-year table and the hero chart chained the benchmark's native-USD
  // closes while the card converted them to the display currency first, so an IDR
  // portfolio was compared against a USD index in two of three places. With USD/IDR
  // rising, all three must measure the benchmark in IDR.
  describe("benchmark in the display currency (#1020)", () => {
    // A close and a distinct, rising USD→IDR rate on every snapshot date, so the card's
    // first-common-date rebase and the table's prior-close anchor see the same window.
    const DATES = ["2013-12-31", "2014-06-30", "2014-12-31", "2015-06-30", "2015-12-31"];
    const NAV = ["1000", "1050", "1100", "1200", "1300"];
    const CLOSE = ["100", "110", "120", "125", "130"];
    const FX = ["10000", "11000", "12000", "13000", "14000"];
    const idr = (i: number) => Number(CLOSE[i]) * Number(FX[i]);

    async function seed(sub: string): Promise<{ t: string; portfolioId: string }> {
      const t = await token(sub);
      const create = await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(t),
        payload: { name: "Benchmark FX", baseCurrency: "IDR", cashCounted: true },
      });
      const portfolioId = create.json().id as string;
      const [u] = await app.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.authSub, sub))
        .limit(1);
      await app.db
        .insert(fxRates)
        .values(DATES.map((date, i) => ({ base: "USD", quote: "IDR", rate: FX[i]!, date })))
        .onConflictDoUpdate({
          target: [fxRates.base, fxRates.quote, fxRates.date],
          set: { rate: sql`excluded.rate` },
        });
      await app.db.insert(benchmarkPrices).values(
        DATES.map((date, i) => ({
          userId: u!.id,
          symbol: "^GSPC",
          date,
          close: CLOSE[i]!,
          currency: "USD",
          source: "test",
        })),
      );
      await app.db.insert(portfolioSnapshots).values(
        DATES.map((date, i) => ({
          portfolioId,
          date,
          netWorth: NAV[i]!,
          marketValue: NAV[i]!,
          effectiveFlow: i === 0 ? NAV[0]! : "0",
          currency: "IDR",
        })),
      );
      return { t, portfolioId };
    }

    it("measures the per-year benchmark TWR in IDR and reconciles it with the card", async () => {
      const { t } = await seed("insights-bm-fx-user");
      const res = await app.inject({ method: "GET", url: "/insights?range=all", headers: auth(t) });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      type Row = {
        year: number;
        portfolioTwr: string | null;
        benchmarks: { symbol: string; twr: string | null }[];
      };
      const row = (y: number) => body.yearlyReturns.find((r: Row) => r.year === y) as Row;
      const bmTwr = (y: number) => Number(row(y).benchmarks.find((b) => b.symbol === "^GSPC")!.twr);

      // The IDR ratio (+44%, +26.39%), not the USD one (+20%, +8.33%).
      expect(bmTwr(2014)).toBeCloseTo(idr(2) / idr(0) - 1, 6);
      expect(bmTwr(2015)).toBeCloseTo(idr(4) / idr(2) - 1, 6);

      // Card active return = chained per-year portfolio TWR − chained per-year benchmark TWR.
      let pf = 1;
      let bm = 1;
      for (const y of [2014, 2015]) {
        pf *= 1 + Number(row(y).portfolioTwr);
        bm *= 1 + bmTwr(y);
      }
      expect(body.benchmark).not.toBeNull();
      expect(Number(body.benchmark.activeReturn)).toBeCloseTo(pf - bm, 6);
      // 1300/1000 − 130·14000/(100·10000) = 0.3 − 0.82.
      expect(Number(body.benchmark.activeReturn)).toBeCloseTo(-0.52, 6);
    });

    it("measures the hero and per-portfolio history benchmark in IDR", async () => {
      const { t, portfolioId } = await seed("history-bm-fx-user");
      const total = (idr(4) / idr(0) - 1) * 100; // +82%, vs +30% in USD
      for (const url of [
        "/networth/history?range=all",
        `/portfolios/${portfolioId}/history?range=all`,
      ]) {
        const res = await app.inject({ method: "GET", url, headers: auth(t) });
        expect(res.statusCode).toBe(200);
        const body = res.json() as { date: string; benchmarkPct?: string }[];
        expect(body).toHaveLength(DATES.length);
        expect(body[0]!.benchmarkPct).toBe("0");
        expect(Number(body[2]!.benchmarkPct)).toBeCloseTo((idr(2) / idr(0) - 1) * 100, 6);
        expect(Number(body.at(-1)!.benchmarkPct)).toBeCloseTo(total, 6);
      }
    });
  });
});

describe("yearEndNavs (audit B12)", () => {
  const pf = (id: string, flows: [string, string][]) => ({
    id,
    flows: flows.map(([date, marketValue]) => ({ date, marketValue, currency: "EUR" })),
  });

  it("sums each portfolio's last snapshot of the year (parity with the float path)", () => {
    const navs = yearEndNavs(
      [
        pf("a", [
          ["2025-06-30", "100"],
          ["2025-12-31", "150"],
          ["2026-03-31", "160"],
        ]),
        pf("b", [["2025-11-30", "50"]]),
      ],
      [2025, 2026],
    );
    expect(navs.get(2025)).toBe(String(150 + 50));
    expect(navs.get(2026)).toBe("160");
  });

  it("does not drift: 0.1 + 0.2 = 0.3", () => {
    const navs = yearEndNavs(
      [pf("a", [["2025-12-31", "0.1"]]), pf("b", [["2025-12-31", "0.2"]])],
      [2025],
    );
    expect(navs.get(2025)).toBe("0.3"); // float: "0.30000000000000004"
  });
});
