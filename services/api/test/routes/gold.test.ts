import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { instruments, loans, transactions } from "@portfolio/db";
import { FixtureProvider, MarketDataService } from "@portfolio/market-data";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";
import { overrideMarketData, invalidateMarketData } from "../../src/services/market-data.js";

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

async function createPortfolio(t: string, name: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/portfolios",
    headers: auth(t),
    payload: { name, baseCurrency: "idr", cashCounted: false },
  });
  return res.json().id as string;
}

// n1 paid (booked below), n2 unpaid and long past due → overdue, n3 far in the future.
const SCHEDULE = [
  {
    n: 1,
    dueDate: "2026-01-13",
    pokok: "1000",
    sewaModal: "100",
    angsuran: "1100",
    sisaPokok: "2000",
  },
  {
    n: 2,
    dueDate: "2026-02-13",
    pokok: "1000",
    sewaModal: "100",
    angsuran: "1100",
    sisaPokok: "1000",
  },
  {
    n: 3,
    dueDate: "2099-03-13",
    pokok: "1000",
    sewaModal: "100",
    angsuran: "1100",
    sisaPokok: "0",
  },
];

describe("gold report", () => {
  let owner: string;
  let ownerPf: string;
  let planInstrumentId: string;
  let loanId: string;

  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp({ authKey: kp.publicKey });
    // 1 g = 1200 for the financed bar; the loose bar has no quote → valued at cost.
    overrideMarketData(
      new MarketDataService([new FixtureProvider({ "G24:PLAN-1": "1200", BBCA: "9500" })]),
    );

    owner = await token("gold-owner");
    await app.inject({ method: "GET", url: "/me", headers: auth(owner) }); // upsert user
    ownerPf = await createPortfolio(owner, "Gold");

    const [plan, loose, equity] = await app.db
      .insert(instruments)
      .values([
        {
          symbol: "G24:PLAN-1",
          market: "GALERI24",
          assetClass: "gold",
          currency: "IDR",
          unit: "grams",
          name: "LM 3 Gram",
        },
        {
          symbol: "G24:LOOSE",
          market: "UBS",
          assetClass: "gold",
          currency: "IDR",
          unit: "grams",
          name: "UBS 2 Gram",
        },
        { symbol: "BBCA", market: "IDX", assetClass: "equity", currency: "IDR", name: "BCA" },
      ])
      .returning();
    planInstrumentId = plan.id;

    const [loan] = await app.db
      .insert(loans)
      .values({
        portfolioId: ownerPf,
        instrumentId: plan.id,
        contractNo: "PLAN-1",
        provider: "GALERI24",
        purchasePrice: "3500",
        downPayment: "500",
        principal: "3000",
        marginTotal: "300",
        tenorMonths: 3,
        monthlyInstallment: "1100",
        startDate: "2025-12-13",
        schedule: SCHEDULE,
        currency: "IDR",
      })
      .returning();
    loanId = loan.id;

    const base = { portfolioId: ownerPf, currency: "IDR", source: "manual" as const };
    await app.db.insert(transactions).values([
      {
        ...base,
        instrumentId: plan.id,
        type: "buy",
        quantity: "3",
        price: "1166.66",
        fees: "0.02",
        executedAt: new Date("2025-12-13T00:00:00Z"),
        loanId,
        externalId: "g1",
      },
      {
        ...base,
        instrumentId: null,
        type: "loan_drawdown",
        quantity: "0",
        price: "3000",
        fees: "0",
        executedAt: new Date("2025-12-13T00:00:00Z"),
        loanId,
        externalId: "g2",
      },
      {
        ...base,
        instrumentId: null,
        type: "loan_repayment",
        quantity: "0",
        price: "1000",
        fees: "100",
        executedAt: new Date("2026-01-13T00:00:00Z"),
        loanId,
        externalId: "g3",
      },
      {
        ...base,
        instrumentId: loose.id,
        type: "buy",
        quantity: "2",
        price: "1000",
        fees: "0",
        executedAt: new Date("2026-01-02T00:00:00Z"),
        externalId: "g4",
      },
      {
        ...base,
        instrumentId: equity.id,
        type: "buy",
        quantity: "10",
        price: "9000",
        fees: "0",
        executedAt: new Date("2026-01-03T00:00:00Z"),
        externalId: "g5",
      },
    ]);
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    invalidateMarketData();
    delete process.env.AUTHENTIK_ISSUER;
    delete process.env.AUTHENTIK_AUDIENCE;
    delete process.env.RATE_LIMIT_MAX;
  });

  it("lists only gold holdings, valued at the buyback, with unpriced bars flagged at-cost", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${ownerPf}/gold`,
      headers: auth(owner),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.displayCurrency).toBe("IDR");
    expect(body.holdings).toHaveLength(2); // the BBCA equity is excluded
    const planned = body.holdings.find((h: { symbol: string }) => h.symbol === "G24:PLAN-1");
    expect(planned).toMatchObject({
      grams: "3",
      market: "GALERI24",
      pricePerGram: "1200",
      value: "3600",
      valuedAtCost: false,
      fxMissing: false,
    });
    const loose = body.holdings.find((h: { symbol: string }) => h.symbol === "G24:LOOSE");
    expect(loose).toMatchObject({ grams: "2", market: "UBS", valuedAtCost: true });
    // Totals: grams count everything; value includes the at-cost bar at cost; the measured
    // gain covers only the priced bar (3600 − 3500).
    expect(body.totals.grams).toBe("5");
    expect(body.totals.value).toBe("5600");
    expect(Number(body.totals.unrealized)).toBeCloseTo(100, 6);
    expect(Number(body.totals.measuredCost)).toBeCloseTo(3500, 6);
  });

  it("reports each purchase plan's progress, next due date and outstanding principal", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${ownerPf}/gold`,
      headers: auth(owner),
    });
    const { plans, totals } = res.json();
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      loanId,
      instrumentId: planInstrumentId,
      portfolioId: ownerPf,
      contractNo: "PLAN-1",
      grams: "3",
      paidCount: 1,
      remainingCount: 2,
      paidPrincipal: "1000",
      paidMargin: "100",
      outstandingPrincipal: "2000",
      completed: false,
      value: "3600",
      nextDue: { n: 2, dueDate: "2026-02-13", amount: "1100", overdue: true },
    });
    expect(plans[0].schedule.map((r: { paid: boolean }) => r.paid)).toEqual([true, false, false]);
    expect(totals.outstandingByCurrency).toEqual({ IDR: "2000" });
  });

  it("aggregates across the user's portfolios on /networth/gold", async () => {
    const res = await app.inject({ method: "GET", url: "/networth/gold", headers: auth(owner) });
    expect(res.statusCode).toBe(200);
    expect(res.json().plans).toHaveLength(1);
    expect(res.json().totals.grams).toBe("5");
  });

  it("scopes to the owner: another user gets 404 for the portfolio and an empty network report", async () => {
    const other = await token("gold-other");
    await app.inject({ method: "GET", url: "/me", headers: auth(other) });
    const direct = await app.inject({
      method: "GET",
      url: `/portfolios/${ownerPf}/gold`,
      headers: auth(other),
    });
    expect(direct.statusCode).toBe(404);
    const all = await app.inject({ method: "GET", url: "/networth/gold", headers: auth(other) });
    expect(all.statusCode).toBe(200);
    expect(all.json()).toMatchObject({ holdings: [], plans: [] });
  });

  it("404s on an unknown holder and requires authentication", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/networth/gold?holderId=00000000-0000-0000-0000-000000000000",
      headers: auth(owner),
    });
    expect(res.statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/networth/gold" })).statusCode).toBe(401);
  });
});
