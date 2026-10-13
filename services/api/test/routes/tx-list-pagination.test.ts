import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { transactions } from "@portfolio/db";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";
import {
  paginatedTransactionsResponseSchema,
  paginatedNetworthTransactionsResponseSchema,
} from "@portfolio/schema";

// Audit D5: a list request without `page` used to return every row, unbounded and (per
// portfolio) unordered. Now it is the first page; `?all=1` is the explicit, capped,
// newest-first array; `?ids=` stays an array lookup. Audit D4: an `?ids=` page and a plain
// page used to share one cache key for 60 s.

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

const ROWS = 30;

describe("transaction list pagination contract (audit D5) + ids cache key (audit D4)", () => {
  let t: string;
  let portfolioId: string;
  let ids: string[];

  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp({ authKey: kp.publicKey });

    t = await token("tx-list-pagination-user");
    portfolioId = (
      await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(t),
        payload: { name: "Pagination book", baseCurrency: "EUR" },
      })
    ).json().id as string;
    // Inserted in a shuffled date order so "newest first" is not insertion order.
    const days = Array.from({ length: ROWS }, (_, i) => (i * 7) % ROWS);
    const inserted = await app.db
      .insert(transactions)
      .values(
        days.map((d) => ({
          portfolioId,
          instrumentId: null,
          type: "deposit" as const,
          quantity: "0",
          price: String(100 + d),
          fees: "0",
          currency: "EUR",
          executedAt: new Date(Date.UTC(2026, 0, 1 + d)),
        })),
      )
      .returning({ id: transactions.id });
    ids = inserted.map((r) => r.id);
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    delete process.env.AUTHENTIK_ISSUER;
    delete process.env.AUTHENTIK_AUDIENCE;
    delete process.env.RATE_LIMIT_MAX;
  });

  const isNewestFirst = (rows: { executedAt: string }[]) =>
    rows.every((r, i) => i === 0 || rows[i - 1]!.executedAt >= r.executedAt);

  it("no page param → the first page of 25 (object shape), newest first", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/transactions`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: { executedAt: string }[]; total: number };
    paginatedTransactionsResponseSchema.parse(body);
    expect(Array.isArray(body)).toBe(false);
    expect(body.total).toBe(ROWS);
    expect(body.rows).toHaveLength(25);
    expect(isNewestFirst(body.rows)).toBe(true);
  });

  it("?all=1 → every row as an array, newest first, no truncation header under the cap", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/transactions?all=1`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as { executedAt: string }[];
    expect(rows).toHaveLength(ROWS);
    expect(isNewestFirst(rows)).toBe(true);
    expect(res.headers["x-result-truncated"]).toBeUndefined();
  });

  it("/networth/transactions follows the same contract", async () => {
    const paged = await app.inject({
      method: "GET",
      url: "/networth/transactions",
      headers: auth(t),
    });
    paginatedNetworthTransactionsResponseSchema.parse(paged.json());
    expect(paged.json().rows).toHaveLength(25);
    const all = await app.inject({
      method: "GET",
      url: "/networth/transactions?all=1",
      headers: auth(t),
    });
    const rows = all.json() as { executedAt: string }[];
    expect(rows).toHaveLength(ROWS);
    expect(isNewestFirst(rows)).toBe(true);
  });

  it("?ids= without page stays an array lookup", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/transactions?ids=${ids[0]},${ids[1]}`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as { id: string }[];
    expect(rows.map((r) => r.id).sort()).toEqual([ids[0], ids[1]].sort());
  });

  it("a malformed ?ids= value is an empty array lookup, not a 500 or the default page", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/transactions?ids=not-a-uuid`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    const mixed = await app.inject({
      method: "GET",
      url: `/networth/transactions?ids=garbage,${ids[0]}`,
      headers: auth(t),
    });
    expect(mixed.statusCode).toBe(200);
    expect((mixed.json() as { id: string }[]).map((r) => r.id)).toEqual([ids[0]]);
  });

  it("an ?ids= page and a plain page do not share a cache entry (audit D4)", async () => {
    const plain = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/transactions?page=1&pageSize=25`,
      headers: auth(t),
    });
    expect(plain.json().total).toBe(ROWS);
    const filtered = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/transactions?page=1&pageSize=25&ids=${ids[0]}`,
      headers: auth(t),
    });
    expect(filtered.json().total).toBe(1);
    expect(filtered.json().rows.map((r: { id: string }) => r.id)).toEqual([ids[0]]);
  });
});
