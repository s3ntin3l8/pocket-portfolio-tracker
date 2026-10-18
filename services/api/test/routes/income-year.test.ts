import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { instruments, transactions } from "@portfolio/db";
import { incomeYearResponseSchema } from "@portfolio/schema";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";

// GET /portfolios/:id/income-year feeds the DE tax page's "Investment income · tax withheld"
// table. The api-client types it as Transaction[] (`instrument: InstrumentMeta | null`), but
// the route returned bare rows, so every dividend/coupon row was labelled by the first 8
// characters of its instrument id instead of its symbol.

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

describe("GET /portfolios/:id/income-year", () => {
  let t: string;
  let pf: string;

  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp({ authKey: kp.publicKey });

    t = await token("income-year-user");
    await app.inject({ method: "GET", url: "/me", headers: auth(t) });
    pf = (
      await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(t),
        payload: { name: "Depot", baseCurrency: "EUR", cashCounted: false },
      })
    ).json().id as string;

    const [inst] = await app.db
      .insert(instruments)
      .values({
        symbol: "INCY",
        market: "XETRA",
        assetClass: "equity",
        currency: "EUR",
        name: "Income Year AG",
      })
      .returning();

    await app.db.insert(transactions).values([
      {
        portfolioId: pf,
        instrumentId: inst.id,
        type: "dividend",
        quantity: "0",
        price: "20",
        currency: "EUR",
        executedAt: new Date("2026-03-15T10:00:00.000Z"),
      },
      // Cash interest has no instrument: it must stay `instrument: null`.
      {
        portfolioId: pf,
        instrumentId: null,
        type: "interest",
        quantity: "0",
        price: "5",
        currency: "EUR",
        executedAt: new Date("2026-04-01T10:00:00.000Z"),
      },
    ]);
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    delete process.env.AUTHENTIK_ISSUER;
    delete process.env.AUTHENTIK_AUDIENCE;
    delete process.env.RATE_LIMIT_MAX;
  });

  it("attaches each row's instrument, so income is labelled by symbol, not by id", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${pf}/income-year?year=2026`,
      headers: auth(t),
    });
    expect(res.statusCode, res.body).toBe(200);
    // The contract the api-client's `IncomeYearRow` mirrors; `instrument` is required in it.
    const rows = incomeYearResponseSchema.parse(res.json());
    expect(rows).toHaveLength(2);
    const dividend = rows.find((r) => r.type === "dividend");
    expect(dividend?.instrument).toMatchObject({ symbol: "INCY", name: "Income Year AG" });
    expect(rows.find((r) => r.type === "interest")?.instrument).toBeNull();
  });
});
