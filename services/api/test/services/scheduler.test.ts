import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { users, portfolios, trConnections, ibkrConnections } from "@portfolio/db";
import { ensureDb, closeDb } from "../../src/db/client.js";
import {
  ABANDONED_PAIRING_MS,
  reapAbandonedPairings,
} from "../../src/services/scheduler/cleanup.js";
import { resetStaleSyncFlags } from "../../src/services/scheduler.js";

// resetStaleSyncFlags is the scheduler's startup reaper (see startScheduler in
// scheduler.ts), split out into its own function specifically so it's testable here
// without needing real Postgres/pg-boss — startScheduler itself no-ops on PGlite.
describe("resetStaleSyncFlags", () => {
  let userId: string;
  let portfolioId: string;

  beforeAll(async () => {
    const db = await ensureDb();
    const [user] = await db
      .insert(users)
      .values({ authSub: "scheduler-reaper|u", email: "reaper@example.com" })
      .returning();
    userId = user.id;
    const [pf] = await db
      .insert(portfolios)
      .values({ userId, name: "Reaper Test", baseCurrency: "EUR" })
      .returning();
    portfolioId = pf.id;
  });

  afterAll(async () => {
    await closeDb();
  });

  it("clears a stale syncing=true flag left behind by a killed worker, and reports the count", async () => {
    const db = await ensureDb();
    const [conn] = await db
      .insert(trConnections)
      .values({
        userId,
        portfolioId,
        phoneEnc: "enc-phone",
        pinEnc: "enc-pin",
        status: "connected",
        syncing: true, // simulates a process that died mid-sync, never clearing the flag
      })
      .returning();

    const result = await resetStaleSyncFlags(db);
    expect(result.trConnections).toBe(1);

    const [after] = await db.select().from(trConnections).where(eq(trConnections.id, conn.id));
    expect(after.syncing).toBe(false);
  });

  it("leaves a genuinely idle connection (syncing=false) untouched", async () => {
    const db = await ensureDb();
    const [user2] = await db
      .insert(users)
      .values({ authSub: "scheduler-reaper|idle", email: "reaper-idle@example.com" })
      .returning();
    const [pf2] = await db
      .insert(portfolios)
      .values({ userId: user2.id, name: "Idle", baseCurrency: "EUR" })
      .returning();
    const [conn] = await db
      .insert(trConnections)
      .values({
        userId: user2.id,
        portfolioId: pf2.id,
        phoneEnc: "enc-phone",
        pinEnc: "enc-pin",
        status: "connected",
        syncing: false,
      })
      .returning();
    const updatedAtBefore = conn.updatedAt;

    const result = await resetStaleSyncFlags(db);
    expect(result.trConnections).toBe(0);

    const [after] = await db.select().from(trConnections).where(eq(trConnections.id, conn.id));
    expect(after.syncing).toBe(false);
    expect(after.updatedAt).toEqual(updatedAtBefore);
  });

  it("clears a stale ibkr_connections.syncing flag too, counted separately", async () => {
    const db = await ensureDb();
    const [user3] = await db
      .insert(users)
      .values({ authSub: "scheduler-reaper|ibkr", email: "reaper-ibkr@example.com" })
      .returning();
    const [pf3] = await db
      .insert(portfolios)
      .values({ userId: user3.id, name: "IBKR Reaper", baseCurrency: "USD" })
      .returning();
    const [conn] = await db
      .insert(ibkrConnections)
      .values({
        userId: user3.id,
        portfolioId: pf3.id,
        tokenEnc: "enc-token",
        queryId: "42",
        status: "connected",
        syncing: true,
      })
      .returning();

    const result = await resetStaleSyncFlags(db);
    expect(result.ibkrConnections).toBe(1);
    expect(result.trConnections).toBe(0);

    const [after] = await db.select().from(ibkrConnections).where(eq(ibkrConnections.id, conn.id));
    expect(after.syncing).toBe(false);
  });
});

// A renew the user walked away from must not leave the connection stuck in awaiting_2fa
// (the hourly sweep only syncs `connected` rows).
describe("reapAbandonedPairings", () => {
  async function seed(sub: string, over: Partial<typeof trConnections.$inferInsert>) {
    const db = await ensureDb();
    const [user] = await db
      .insert(users)
      .values({ authSub: `reap-pairing|${sub}`, email: `${sub}@example.com` })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: user.id, name: sub, baseCurrency: "EUR" })
      .returning();
    const [conn] = await db
      .insert(trConnections)
      .values({
        userId: user.id,
        portfolioId: pf.id,
        phoneEnc: "enc-phone",
        pinEnc: "enc-pin",
        status: "awaiting_2fa",
        ...over,
      })
      .returning();
    return conn.id;
  }
  const statusOf = async (id: string) =>
    (await (await ensureDb()).select().from(trConnections).where(eq(trConnections.id, id)))[0]
      .status;
  const old = () => new Date(Date.now() - ABANDONED_PAIRING_MS - 60_000);

  afterAll(async () => {
    await closeDb();
  });

  it("returns an old awaiting_2fa row that once had a session to expired", async () => {
    const id = await seed("old-with-session", { sessionEnc: "enc-session", updatedAt: old() });
    const res = await reapAbandonedPairings(await ensureDb());
    expect(res.trConnections).toBeGreaterThanOrEqual(1);
    expect(await statusOf(id)).toBe("expired");
  });

  it("leaves a fresh pairing (still within its approval window) alone", async () => {
    const id = await seed("fresh", { sessionEnc: "enc-session", updatedAt: new Date() });
    await reapAbandonedPairings(await ensureDb());
    expect(await statusOf(id)).toBe("awaiting_2fa");
  });

  it("leaves a never-connected first setup alone", async () => {
    const id = await seed("first-setup", { sessionEnc: null, updatedAt: old() });
    await reapAbandonedPairings(await ensureDb());
    expect(await statusOf(id)).toBe("awaiting_2fa");
  });

  it("does not touch connected or errored rows", async () => {
    const ok = await seed("connected", {
      status: "connected",
      sessionEnc: "enc-session",
      updatedAt: old(),
    });
    const err = await seed("errored", {
      status: "error",
      sessionEnc: "enc-session",
      updatedAt: old(),
    });
    await reapAbandonedPairings(await ensureDb());
    expect(await statusOf(ok)).toBe("connected");
    expect(await statusOf(err)).toBe("error");
  });

  it("recovers a renew started from an errored connection that never had a session", async () => {
    // first pairing declined (error, no session) -> user tapped Renew -> abandoned
    const id = await seed("error-renew", {
      sessionEnc: null,
      lastError: "approval failed",
      updatedAt: old(),
    });
    await reapAbandonedPairings(await ensureDb());
    expect(await statusOf(id)).toBe("expired");
  });

  it("at boot (olderThanMs 0) reaps even a fresh orphan, stamped with the real time", async () => {
    const id = await seed("boot", { sessionEnc: "enc-session", updatedAt: new Date() });
    const before = Date.now();
    await reapAbandonedPairings(await ensureDb(), { olderThanMs: 0 });
    expect(await statusOf(id)).toBe("expired");
    const [row] = await (
      await ensureDb()
    )
      .select()
      .from(trConnections)
      .where(eq(trConnections.id, id));
    expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row.updatedAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
});
