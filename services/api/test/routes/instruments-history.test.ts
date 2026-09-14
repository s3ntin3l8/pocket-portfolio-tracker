/**
 * Route tests for GET /instruments/:id/history (#749 follow-up).
 *
 * Verifies that a provider HTTP error (rate limit, auth failure, 5xx) is caught at the
 * route layer and returns an empty candle array — matching the pre-#749 behavior where
 * providers returned `null` on non-OK, which the route happily serialized as `[]`. The
 * post-#749 `MarketDataError` throw would otherwise 500 the whole request and break the
 * price-history chart on the instrument detail page.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import {
  MarketDataError,
  MarketDataService,
  type Candle,
  type InstrumentRef,
  type MarketDataProvider,
} from "@portfolio/market-data";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/client.js";
import { instruments } from "@portfolio/db";
import { overrideMarketData, invalidateMarketData } from "../../src/services/market-data.js";

const ISSUER = "https://auth.test/application/o/portfolio/";
const AUDIENCE = "portfolio-tracker";
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let privateKey: CryptoKey;

beforeAll(async () => {
  const kp = await generateKeyPair("ES256");
  privateKey = kp.privateKey;
  process.env.AUTHENTIK_ISSUER = ISSUER;
  process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
  process.env.RATE_LIMIT_MAX = "50000";
  app = await buildApp({ authKey: kp.publicKey });
}, 30_000);

afterAll(async () => {
  await app.close();
  await closeDb();
  delete process.env.AUTHENTIK_ISSUER;
  delete process.env.AUTHENTIK_AUDIENCE;
  delete process.env.RATE_LIMIT_MAX;
});

afterEach(() => {
  invalidateMarketData();
});

async function makeToken(sub: string) {
  return new SignJWT({ email: `${sub}@test.example` })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

class ErroringProvider implements MarketDataProvider {
  readonly name = "erroring";
  supports(): boolean {
    return true;
  }
  async getQuote(): Promise<null> {
    return null;
  }
  async getHistory(): Promise<Candle[]> {
    throw new MarketDataError("erroring 429", this.name, 429);
  }
}

describe("GET /instruments/:id/history — MarketDataError handling (#749)", () => {
  it("returns an empty array on MarketDataError instead of 500", async () => {
    const t = await makeToken("hist-err-user");
    await app.inject({ method: "GET", url: "/me", headers: auth(t) });

    const db = getDb();
    const [inst] = await db
      .insert(instruments)
      .values({
        symbol: "HISTERR",
        market: "US",
        assetClass: "equity",
        unit: "shares",
        currency: "USD",
        name: "History Error Co",
      })
      .returning();

    overrideMarketData(new MarketDataService([new ErroringProvider()]));

    const res = await app.inject({
      method: "GET",
      url: `/instruments/${inst.id}/history?range=1mo`,
      headers: auth(t),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("non-MarketDataError errors still propagate (500)", async () => {
    // Sanity check: only MarketDataError is caught. Other errors (e.g. a TypeError
    // from a buggy provider) should still surface as 500 so they're not silently
    // turned into empty charts.
    const t = await makeToken("hist-err-other-user");
    await app.inject({ method: "GET", url: "/me", headers: auth(t) });

    const db = getDb();
    const [inst] = await db
      .insert(instruments)
      .values({
        symbol: "HISTOTHER",
        market: "US",
        assetClass: "equity",
        unit: "shares",
        currency: "USD",
        name: "History Other Error Co",
      })
      .returning();

    class BuggyProvider implements MarketDataProvider {
      readonly name = "buggy";
      supports(): boolean {
        return true;
      }
      async getQuote(): Promise<null> {
        return null;
      }
      async getHistory(_ref: InstrumentRef): Promise<Candle[]> {
        throw new TypeError("something unexpected");
      }
    }

    overrideMarketData(new MarketDataService([new BuggyProvider()]));

    const res = await app.inject({
      method: "GET",
      url: `/instruments/${inst.id}/history?range=1mo`,
      headers: auth(t),
    });

    expect(res.statusCode).toBe(500);
  });
});
