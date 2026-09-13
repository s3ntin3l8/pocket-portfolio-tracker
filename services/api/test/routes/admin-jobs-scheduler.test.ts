/**
 * Regression test for the `GET /admin/jobs` live-data path.
 *
 * admin.test.ts never exercises the `if (schedulerAvailable)` branch because
 * pg-boss never starts in PGlite/test env (getActiveBoss() returns null).
 * This file mocks getActiveBoss() to return a non-null stub so the
 * `WHERE name IN (${queueNames})` query actually runs — catching any future
 * recurrence of the "op ANY/ALL (array) requires array on right side" bug that
 * was introduced by using `ANY(${array})` instead of `IN ${array}` in a raw
 * Drizzle sql template.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { sql } from "drizzle-orm";
import type * as Scheduler from "../../src/services/scheduler.js";

// Mock the scheduler module so getActiveBoss() returns a non-null stub,
// making the route's `schedulerAvailable` branch reachable. Everything else
// (JOB_DESCRIPTORS, etc.) is kept from the real module.
vi.mock("../../src/services/scheduler.js", async () => {
  const actual = await vi.importActual<typeof Scheduler>("../../src/services/scheduler.js");
  return {
    ...actual,
    // Return a non-null stub — the route only checks `boss !== null`.
    getActiveBoss: vi.fn(() => ({})),
  };
});

// Dynamic imports must come after vi.mock() so they pick up the mock.
const { buildApp } = await import("../../src/app.js");
const { closeDb } = await import("../../src/db/client.js");

const ISSUER = "https://auth.test/application/o/portfolio-jobs-test/";
const AUDIENCE = "portfolio-tracker";
const ADMIN_GROUP = "portfolio-admins";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let privateKey: CryptoKey;

async function token(sub: string, groups?: string[]) {
  return new SignJWT({
    email: `${sub}@example.com`,
    ...(groups ? { groups } : {}),
  })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

describe("GET /admin/jobs — live pgboss query path (scheduler available)", () => {
  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.AUTHENTIK_ADMIN_GROUP = ADMIN_GROUP;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp({ authKey: kp.publicKey });

    // Create a minimal pgboss schema in PGlite so the IN query has a table to
    // query. Only the three columns accessed by the admin route are needed.
    await app.db.execute(sql`CREATE SCHEMA IF NOT EXISTS pgboss`);
    await app.db.execute(sql`
      CREATE TABLE IF NOT EXISTS pgboss.job (
        name         text        NOT NULL,
        state        text        NOT NULL,
        completed_on timestamptz
      )
    `);
    // Seed one recent "completed" and one older "failed" row for refresh-prices.
    // The route aggregates by name and picks the more-recent timestamp.
    await app.db.execute(sql`
      INSERT INTO pgboss.job (name, state, completed_on) VALUES
        ('refresh-prices', 'completed', NOW() - INTERVAL '1 hour'),
        ('refresh-prices', 'failed',    NOW() - INTERVAL '10 days')
    `);
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    delete process.env.AUTHENTIK_ISSUER;
    delete process.env.AUTHENTIK_AUDIENCE;
    delete process.env.AUTHENTIK_ADMIN_GROUP;
    delete process.env.RATE_LIMIT_MAX;
  });

  it("returns schedulerAvailable:true and populates lastRunAt/lastStatus from pgboss", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/jobs",
      headers: auth(await token("admin-live-jobs-1", [ADMIN_GROUP])),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      schedulerAvailable: boolean;
      jobs: { name: string; lastRunAt: string | null; lastStatus: string | null }[];
    };

    // Scheduler is "running" (getActiveBoss returns a non-null stub).
    expect(body.schedulerAvailable).toBe(true);

    // All known job descriptors are still listed.
    expect(body.jobs).toHaveLength(11);

    // The seeded job has a "completed" row more recent than the "failed" row.
    const prices = body.jobs.find((j) => j.name === "refresh-prices");
    expect(prices).toBeDefined();
    expect(prices?.lastStatus).toBe("completed");
    expect(prices?.lastRunAt).not.toBeNull();

    // Unseeded jobs should still have null fields — they have no pgboss rows.
    const snapshot = body.jobs.find((j) => j.name === "daily-snapshot");
    expect(snapshot?.lastRunAt).toBeNull();
    expect(snapshot?.lastStatus).toBeNull();
  });

  // #745: the two backfill handlers now rethrow on failure instead of swallowing it, so
  // pg-boss should genuinely record `state: 'failed'` for a real failure — this pins that
  // the route surfaces that truthfully rather than the old "Completed" pill regardless of
  // outcome. Also covers the new in-flight/fan-out counters added alongside the rethrow.
  it("surfaces a genuine failure and in-flight/fan-out counts for the backfill queues", async () => {
    await app.db.execute(sql`
      INSERT INTO pgboss.job (name, state, completed_on) VALUES
        ('backfill-stale-history', 'failed', NOW() - INTERVAL '1 minute')
    `);
    await app.db.execute(sql`
      INSERT INTO pgboss.job (name, state, completed_on) VALUES
        ('backfill-portfolio', 'active', NULL),
        ('backfill-portfolio', 'created', NULL),
        ('backfill-portfolio', 'completed', NOW() - INTERVAL '1 minute')
    `);

    const res = await app.inject({
      method: "GET",
      url: "/admin/jobs",
      headers: auth(await token("admin-live-jobs-2", [ADMIN_GROUP])),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      jobs: {
        name: string;
        lastStatus: string | null;
        inProgress?: number;
        fanOutRemaining?: number;
      }[];
    };

    const stale = body.jobs.find((j) => j.name === "backfill-stale-history");
    expect(stale?.lastStatus).toBe("failed");
    // Two backfill-portfolio rows (active + created) are still in flight.
    expect(stale?.fanOutRemaining).toBe(2);

    // backfill-portfolio itself is not a user-triggerable JOB_DESCRIPTOR, so it isn't in
    // the response list directly — only surfaced via backfill-stale-history's fanOut.
    expect(body.jobs.find((j) => j.name === "backfill-portfolio")).toBeUndefined();
  });
});
