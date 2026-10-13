import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPair } from "jose";
import {
  netWorthResponseSchema,
  portfolioSummaryResponseSchema,
  paginatedTransactionsResponseSchema,
  paginatedNetworthTransactionsResponseSchema,
} from "@portfolio/schema";
import { buildApp } from "../../src/app.js";
import { ensureDb, closeDb } from "../../src/db/client.js";

// The response schemas are the contract `@portfolio/api-client` validates against. The
// fixtures in the other route tests are tiny; this runs them over the full demo dataset
// (allocation, drift, lots, sparklines, transfers, FX, income, several portfolios) so a
// field the schemas get wrong shows up here, not as a dev-only `invalid_response` in the UI.

process.env.SEED_DEMO_EMAIL = "response-contract-demo@example.com";
const { seedDemo } = await import("../../src/db/seed-demo.js");

let app: Awaited<ReturnType<typeof buildApp>>;
let dir: string;
let headers: { authorization: string };

describe("response schemas over the demo dataset", () => {
  beforeAll(async () => {
    process.env.RATE_LIMIT_MAX = "10000";
    await ensureDb();
    dir = await mkdtemp(join(tmpdir(), "response-contract-"));
    const patFile = join(dir, "pat");
    await seedDemo(patFile);
    headers = { authorization: `Bearer ${(await readFile(patFile, "utf8")).trim()}` };
    app = await buildApp({ authKey: (await generateKeyPair("ES256")).publicKey });
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await closeDb();
    await rm(dir, { recursive: true, force: true });
    delete process.env.RATE_LIMIT_MAX;
  });

  async function get(url: string) {
    const res = await app.inject({ method: "GET", url, headers });
    expect(res.statusCode, url).toBe(200);
    return res.json();
  }

  it("/networth", async () => {
    const body = await get("/networth");
    expect(body.holdings.length).toBeGreaterThan(0);
    netWorthResponseSchema.parse(body);
    netWorthResponseSchema.parse(await get("/networth?period=1y"));
  }, 60_000);

  it("/portfolios/:id/summary for every portfolio", async () => {
    const portfolios = (await get("/portfolios")) as { id: string }[];
    expect(portfolios.length).toBeGreaterThan(0);
    for (const p of portfolios) {
      portfolioSummaryResponseSchema.parse(await get(`/portfolios/${p.id}/summary`));
    }
  }, 120_000);

  it("paginated transaction lists", async () => {
    const portfolios = (await get("/portfolios")) as { id: string }[];
    for (const p of portfolios) {
      paginatedTransactionsResponseSchema.parse(
        await get(`/portfolios/${p.id}/transactions?page=1&pageSize=100`),
      );
      paginatedTransactionsResponseSchema.parse(
        await get(`/portfolios/${p.id}/transactions?page=1&pageSize=100&convertTo=USD`),
      );
    }
    const all = paginatedNetworthTransactionsResponseSchema.parse(
      await get("/networth/transactions?page=1&pageSize=100"),
    );
    expect(all.rows.length).toBeGreaterThan(0);
  }, 120_000);
});
