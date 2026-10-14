import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { instruments, portfolios, trConnections } from "@portfolio/db";
import { buildApp } from "../../src/app.js";
import { getDb, closeDb } from "../../src/db/client.js";

// A broker position gap is detected from ISINs alone. The anomalies endpoint resolves each
// ISIN to its instrument (into `meta`, so the banner can name + link it) and tags every
// portfolio-level reconciliation anomaly with its portfolio (the aggregate view merges
// several portfolios' banners and must tell them apart).

const ISSUER = "https://auth.test/application/o/portfolio/";
const AUDIENCE = "portfolio-tracker";
const KNOWN_ISIN = "US0000POSGAP1";
const UNKNOWN_ISIN = "XX0000POSGAP9";

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let privateKey: CryptoKey;
let instrumentId: string;

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

describe("position_gap anomalies carry their instrument and portfolio", () => {
  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp({ authKey: kp.publicKey });
    const [i] = await app.db
      .insert(instruments)
      .values({
        symbol: "POSGAP",
        market: "XETRA",
        assetClass: "equity",
        currency: "EUR",
        name: "Position gap instrument",
        isin: KNOWN_ISIN,
      })
      .returning();
    instrumentId = i.id;
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
    await app.inject({ method: "GET", url: "/me", headers: auth(t) });
    const created = await app.inject({
      method: "POST",
      url: "/portfolios",
      headers: auth(t),
      payload: { name: "Gap", baseCurrency: "EUR" },
    });
    const portfolioId = created.json().id as string;
    const db = getDb();
    const [{ userId }] = await db
      .select({ userId: portfolios.userId })
      .from(portfolios)
      .where(eq(portfolios.id, portfolioId));
    await db.insert(trConnections).values({
      userId,
      portfolioId,
      phoneEnc: "enc",
      pinEnc: "enc",
      lastReconciliation: {
        checkedAt: "2026-07-08T00:00:00.000Z",
        cash: [{ currency: "EUR", reported: "271.35", derived: "277.61", diff: "-6.26" }],
        positions: [
          { isin: KNOWN_ISIN, reported: "29.012179", derived: "28.876429", diff: "0.135750" },
          { isin: UNKNOWN_ISIN, reported: "5.000000", derived: "4.000000", diff: "1.000000" },
        ],
      },
    });
    return { t, portfolioId };
  }

  it("resolves a known ISIN to the instrument (meta, not Anomaly.instrumentId) and tags the portfolio", async () => {
    const { t, portfolioId } = await setup("position-gap-known");
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/anomalies`,
      headers: auth(t),
    });
    const anomalies = res.json().anomalies as {
      code: string;
      instrumentId?: string;
      meta: Record<string, string>;
    }[];

    const known = anomalies.find((a) => a.code === "position_gap" && a.meta.isin === KNOWN_ISIN)!;
    expect(known.meta.instrumentId).toBe(instrumentId);
    expect(known.meta.symbol).toBe("POSGAP");
    expect(known.meta.portfolioId).toBe(portfolioId);
    // The instrument page filters anomalies on `instrumentId`; a portfolio-level gap must not
    // be attributed to the instrument's own transactions.
    expect(known.instrumentId).toBeUndefined();

    const unknown = anomalies.find(
      (a) => a.code === "position_gap" && a.meta.isin === UNKNOWN_ISIN,
    )!;
    expect(unknown.meta.instrumentId).toBeUndefined();
    expect(unknown.meta.portfolioId).toBe(portfolioId);

    const cash = anomalies.find((a) => a.code === "reconciliation_gap")!;
    expect(cash.meta.portfolioId).toBe(portfolioId);
  });

  it("the networth view tags each portfolio's gaps with that portfolio", async () => {
    const { t, portfolioId } = await setup("position-gap-networth");
    const res = await app.inject({ method: "GET", url: "/networth/anomalies", headers: auth(t) });
    const anomalies = res.json().anomalies as { code: string; meta: Record<string, string> }[];
    const gaps = anomalies.filter((a) => a.code === "position_gap");
    expect(gaps.length).toBe(2);
    expect(gaps.every((g) => g.meta.portfolioId === portfolioId)).toBe(true);
  });
});
