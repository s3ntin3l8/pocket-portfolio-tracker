import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPair } from "jose";
import { buildApp } from "../../src/app.js";
import { ensureDb, closeDb } from "../../src/db/client.js";
import { checkIntegrity, collectBodies } from "../../src/services/integrity/index.js";

// The demo dataset (several portfolios, FX, lots, transfers, income, both boundaries) is the
// closest thing to a real user's data in the test suite. Its dates are relative to the run
// date, so it can't hold golden numbers — but the invariants don't need any.

process.env.SEED_DEMO_EMAIL = "integrity-demo@example.com";
const { seedDemo } = await import("../../src/db/seed-demo.js");

let app: Awaited<ReturnType<typeof buildApp>>;
let dir: string;
let headers: { authorization: string };

describe("invariants over the demo dataset", () => {
  beforeAll(async () => {
    process.env.RATE_LIMIT_MAX = "10000";
    await ensureDb();
    dir = await mkdtemp(join(tmpdir(), "integrity-demo-"));
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

  it("reports no findings", async () => {
    const bodies = await collectBodies(async (url) => {
      const res = await app.inject({ method: "GET", url, headers });
      if (res.statusCode !== 200) throw new Error(`${url} -> ${res.statusCode}`);
      return res.json();
    });
    expect(bodies.portfolios.length).toBeGreaterThan(1);
    expect(checkIntegrity(bodies)).toEqual([]);
  }, 120_000);
});
