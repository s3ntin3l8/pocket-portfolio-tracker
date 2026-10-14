import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { inArray } from "drizzle-orm";
import { instruments, transactions } from "@portfolio/db";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";

// "Drafts only" on Activity used to filter the already-loaded 25 rows client-side, so a
// portfolio with 1000+ rows showed "25 drafts" no matter how many existed. The list routes
// now take `?status=draft` (rows + total) and return `draftCount`, and `?all=1&fields=ids`
// returns just id/portfolioId/status for "select all N matching".

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

describe("?status=draft on the transaction list routes", () => {
  let instrumentId: string;

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
        symbol: "STATUSX",
        market: "IDX",
        assetClass: "equity",
        currency: "IDR",
        name: "Status filter instrument",
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

  async function setup(sub: string, normal: number, drafts: number) {
    const t = await token(sub);
    const pf = await app.inject({
      method: "POST",
      url: "/portfolios",
      headers: auth(t),
      payload: { name: `Status ${sub}`, baseCurrency: "idr" },
    });
    const portfolioId = pf.json().id as string;
    const ids: string[] = [];
    for (let i = 0; i < normal + drafts; i++) {
      const res = await app.inject({
        method: "POST",
        url: `/portfolios/${portfolioId}/transactions`,
        headers: auth(t),
        payload: {
          type: "buy",
          instrumentId,
          quantity: "1",
          price: "100",
          currency: "IDR",
          // Distinct days so ordering is deterministic and no dedup fingerprint collides.
          executedAt: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
        },
      });
      expect(res.statusCode).toBe(201);
      ids.push(res.json().id as string);
    }
    const draftIds = ids.slice(0, drafts);
    if (draftIds.length > 0) {
      await app.db
        .update(transactions)
        .set({ status: "draft" })
        .where(inArray(transactions.id, draftIds));
    }
    return { t, portfolioId, draftIds: new Set(draftIds) };
  }

  it("narrows rows AND total to drafts, and draftCount ignores the status filter", async () => {
    const { t, portfolioId, draftIds } = await setup("status-filter-portfolio", 4, 3);

    const all = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/transactions?page=1&pageSize=2`,
      headers: auth(t),
    });
    expect(all.json().total).toBe(7);
    expect(all.json().draftCount).toBe(3);

    const drafts = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/transactions?status=draft&page=1&pageSize=2`,
      headers: auth(t),
    });
    const body = drafts.json();
    expect(body.total).toBe(3);
    expect(body.draftCount).toBe(3);
    expect(body.rows).toHaveLength(2);
    for (const r of body.rows) expect(draftIds.has(r.id)).toBe(true);

    // Page 2 holds the remaining draft — paging walks drafts only, not every row.
    const page2 = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/transactions?status=draft&page=2&pageSize=2`,
      headers: auth(t),
    });
    expect(page2.json().rows).toHaveLength(1);
  });

  it("draftCount respects the other filters (type) and is 0 when none match", async () => {
    const { t, portfolioId } = await setup("status-filter-type", 2, 2);
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/transactions?type=sell&page=1`,
      headers: auth(t),
    });
    expect(res.json().total).toBe(0);
    expect(res.json().draftCount).toBe(0);
  });

  it("networth route: status=draft narrows rows/total and reports draftCount", async () => {
    const { t, draftIds } = await setup("status-filter-networth", 3, 2);
    const res = await app.inject({
      method: "GET",
      url: "/networth/transactions?status=draft&page=1",
      headers: auth(t),
    });
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.draftCount).toBe(2);
    for (const r of body.rows) expect(draftIds.has(r.id)).toBe(true);
  });

  it("?all=1&fields=ids returns just id/portfolioId/status, honouring status", async () => {
    const { t, portfolioId, draftIds } = await setup("status-filter-ids", 3, 2);

    const everything = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/transactions?all=1&fields=ids`,
      headers: auth(t),
    });
    expect(everything.statusCode).toBe(200);
    expect(everything.json()).toHaveLength(5);
    expect(Object.keys(everything.json()[0]).sort()).toEqual(["id", "portfolioId", "status"]);

    const onlyDrafts = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/transactions?all=1&fields=ids&status=draft`,
      headers: auth(t),
    });
    const keys = onlyDrafts.json() as { id: string; portfolioId: string; status: string }[];
    expect(new Set(keys.map((k) => k.id))).toEqual(draftIds);
    expect(keys.every((k) => k.status === "draft" && k.portfolioId === portfolioId)).toBe(true);

    const networth = await app.inject({
      method: "GET",
      url: "/networth/transactions?all=1&fields=ids&status=draft",
      headers: auth(t),
    });
    expect(networth.json()).toHaveLength(2);
  });
});
