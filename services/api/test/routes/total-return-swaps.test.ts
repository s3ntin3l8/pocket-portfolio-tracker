import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { instruments, transactions } from "@portfolio/db";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";

// Audit B8: totalReturnPct = (currentValue + Σ positive flows − gross) / gross. A merger's
// sell leg (and the dividend a `reinvestment` buy was paid from) entered the positive
// flows while their buy legs are (rightly) kept out of `gross` and the new shares are in
// `currentValue` — the same value counted twice.

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

describe("totalReturnPct — merger / reinvestment swaps are not returns (audit B8)", () => {
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

  it("a merger pair plus a reinvested dividend leave the return at value − capital", async () => {
    const t = await token("total-return-swaps-user");
    const portfolioId = (
      await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(t),
        // cash OUTSIDE the boundary — the only one totalReturnPct is computed for.
        payload: { name: "Fund merger book", baseCurrency: "EUR", cashCounted: false },
      })
    ).json().id as string;
    const [oldFund, newFund] = await app.db
      .insert(instruments)
      .values([
        {
          symbol: "B8OLD",
          market: "XETRA",
          assetClass: "mutual_fund",
          currency: "EUR",
          name: "Old fund",
        },
        {
          symbol: "B8NEW",
          market: "XETRA",
          assetClass: "mutual_fund",
          currency: "EUR",
          name: "New fund",
        },
      ])
      .returning();
    const base = { portfolioId, currency: "EUR", fees: "0" };
    const at = (d: string) => new Date(`${d}T10:00:00.000Z`);
    await app.db.insert(transactions).values([
      // 1,000 of the user's own capital.
      {
        ...base,
        instrumentId: oldFund!.id,
        type: "buy",
        quantity: "10",
        price: "100",
        executedAt: at("2025-01-10"),
      },
      // Fund merger: old position out at 1,200, new one in at the same 1,200.
      {
        ...base,
        instrumentId: oldFund!.id,
        type: "sell",
        kind: "merger",
        quantity: "10",
        price: "120",
        executedAt: at("2025-06-01"),
      },
      {
        ...base,
        instrumentId: newFund!.id,
        type: "buy",
        kind: "merger",
        quantity: "12",
        price: "100",
        executedAt: at("2025-06-01"),
      },
      // A 50 dividend, reinvested straight back into the fund.
      {
        ...base,
        instrumentId: newFund!.id,
        type: "dividend",
        quantity: "0",
        price: "50",
        executedAt: at("2025-09-01"),
      },
      {
        ...base,
        instrumentId: newFund!.id,
        type: "buy",
        kind: "reinvestment",
        quantity: "0.5",
        price: "100",
        executedAt: at("2025-09-01"),
      },
    ]);

    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/contributions`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      totalContributed: string;
      currentValue: string;
      totalReturnPct: number | null;
    };
    expect(body.totalContributed).toBe("1000");
    // Unpriced → valued at cost: 12.5 new-fund shares carrying 1,250 of basis.
    expect(Number(body.currentValue)).toBe(1250);
    // (1250 + 0 received − 1000) / 1000 — pre-fix (1250 + 1200 + 50 − 1000) / 1000 = 1.5.
    expect(body.totalReturnPct).toBeCloseTo(0.25, 10);
  });
});
