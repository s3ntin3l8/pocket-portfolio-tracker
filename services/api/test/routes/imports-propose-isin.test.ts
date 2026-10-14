/**
 * A confirmed AI proposal that carries an ISIN takes the EU/OpenFIGI instrument path, and the
 * provenance row of the booked transaction says "manual".
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { instruments, screenshotImports, transactionSources, transactions } from "@portfolio/db";

// Network-free symbol search: only the ISIN under test resolves.
vi.mock("../../src/services/market-data.js", async () => {
  const real = await vi.importActual<Record<string, unknown>>("../../src/services/market-data.js");
  return {
    ...real,
    getMarketData: async () => ({
      search: async (q: string) =>
        q === "US0378331005"
          ? [{ symbol: "AAPL", market: "US", currency: "USD", assetClass: "equity" }]
          : [],
    }),
  };
});

import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/client.js";

const ISSUER = "https://auth.test/application/o/portfolio/";
const AUDIENCE = "portfolio-tracker";
type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let privateKey: CryptoKey;

const auth = (t: string) => ({ authorization: `Bearer ${t}` });
async function jwt(sub: string) {
  return new SignJWT({ email: `${sub}@example.com` })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}

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
  delete process.env.RATE_LIMIT_MAX;
});

describe("confirming an AI proposal with an ISIN", () => {
  it("resolves the instrument through its ISIN and records a manual provenance row", async () => {
    const t = await jwt("propose-isin");
    const portfolioId = (
      await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(t),
        payload: { name: "Euro Depot", baseCurrency: "USD" },
      })
    ).json().id as string;

    const res = await app.inject({
      method: "POST",
      url: "/imports/propose",
      headers: auth(t),
      payload: {
        portfolioId,
        transactions: [
          {
            action: "buy",
            isin: "US0378331005",
            name: "Apple Inc.",
            quantity: "3",
            price: "190",
            currency: "usd",
            executedAt: "2026-05-04",
          },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const { importId } = res.json();
    const [imp] = await getDb()
      .select()
      .from(screenshotImports)
      .where(eq(screenshotImports.id, importId));
    const drafts = (imp!.parsedJson as { drafts: { currency: string }[] }).drafts;
    expect(drafts[0]!.currency).toBe("USD"); // upper-cased by the server

    const confirm = await app.inject({
      method: "POST",
      url: `/imports/${importId}/confirm`,
      headers: auth(t),
      payload: { portfolioId, transactions: drafts },
    });
    expect(confirm.statusCode).toBe(201);

    const [tx] = await getDb()
      .select()
      .from(transactions)
      .where(eq(transactions.portfolioId, portfolioId));
    expect(tx!.source).toBe("manual");
    const [inst] = await getDb()
      .select()
      .from(instruments)
      .where(eq(instruments.id, tx!.instrumentId!));
    // Resolved via the ISIN: the real symbol and market, not an IDX placeholder named after the ISIN.
    expect(inst).toMatchObject({ symbol: "AAPL", market: "US", isin: "US0378331005" });

    const [src] = await getDb()
      .select()
      .from(transactionSources)
      .where(eq(transactionSources.transactionId, tx!.id));
    expect(src!.sourceType).toBe("manual");
  });
});
