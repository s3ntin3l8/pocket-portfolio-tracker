import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { adminAuditLog, users } from "@portfolio/db";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";
import { setActiveBoss } from "../../src/services/scheduler/enqueue.js";

const ISSUER = "https://auth.test/application/o/portfolio/";
const AUDIENCE = "portfolio-tracker";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let privateKey: CryptoKey;

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

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function mintPat(ownerJwt: string, scope: "read" | "write") {
  const res = await app.inject({
    method: "POST",
    url: "/me/tokens",
    headers: auth(ownerJwt),
    payload: { name: `jobs-${scope}`, scope },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { token: string }).token;
}

/** A fake pg-boss that records sends and collapses repeats like a singleton key does. */
function fakeBoss() {
  const sent: Array<{ name: string; data: Record<string, unknown> }> = [];
  const keys = new Set<string>();
  setActiveBoss({
    send: async (name: string, data: Record<string, unknown>, opts: { singletonKey?: string }) => {
      if (opts.singletonKey !== undefined) {
        if (keys.has(opts.singletonKey)) return null;
        keys.add(opts.singletonKey);
      }
      sent.push({ name, data });
      return "job-id";
    },
  } as unknown as Parameters<typeof setActiveBoss>[0]);
  return sent;
}

describe("POST /me/jobs/backfill", () => {
  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp({ authKey: kp.publicKey });
  });

  afterAll(async () => {
    setActiveBoss(null);
    await app.close();
    await closeDb();
    delete process.env.AUTHENTIK_ISSUER;
    delete process.env.AUTHENTIK_AUDIENCE;
    delete process.env.RATE_LIMIT_MAX;
  });

  it("enqueues a forced backfill for the caller only, ignoring a userId in the body, and audits it", async () => {
    const sent = fakeBoss();
    try {
      const t = await jwt("mj-own");
      const res = await app.inject({
        method: "POST",
        url: "/me/jobs/backfill",
        headers: auth(t),
        payload: { userId: "someone-else", force: false },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ queued: true, retryDeadFeeds: false });

      const [me] = await app.db.select().from(users).where(eq(users.authSub, "mj-own"));
      expect(sent).toEqual([
        { name: "backfill-stale-history", data: { force: true, userId: me.id } },
      ]);

      const audit = await app.db
        .select()
        .from(adminAuditLog)
        .where(eq(adminAuditLog.actorSub, "mj-own"));
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action: "user_trigger_backfill",
        target: "backfill-stale-history",
        meta: { force: true, userId: me.id },
      });
    } finally {
      setActiveBoss(null);
    }
  });

  it("passes retryDeadFeeds through only when explicitly true", async () => {
    const sent = fakeBoss();
    try {
      const t = await jwt("mj-retry");
      const res = await app.inject({
        method: "POST",
        url: "/me/jobs/backfill",
        headers: auth(t),
        payload: { retryDeadFeeds: true },
      });
      expect(res.statusCode).toBe(200);
      expect(sent[0].data).toMatchObject({ force: true, retryDeadFeeds: true });
    } finally {
      setActiveBoss(null);
    }
  });

  it("refuses a read-scoped PAT but accepts a write-scoped one", async () => {
    const sent = fakeBoss();
    try {
      const t = await jwt("mj-pat");
      const read = await mintPat(t, "read");
      const write = await mintPat(t, "write");
      const denied = await app.inject({
        method: "POST",
        url: "/me/jobs/backfill",
        headers: auth(read),
      });
      expect(denied.statusCode).toBe(403);
      expect(sent).toHaveLength(0);

      const ok = await app.inject({
        method: "POST",
        url: "/me/jobs/backfill",
        headers: auth(write),
      });
      expect(ok.statusCode).toBe(200);
      expect(sent).toHaveLength(1);
    } finally {
      setActiveBoss(null);
    }
  });

  it("returns 409 on an immediate repeat and 503 without a scheduler", async () => {
    fakeBoss();
    try {
      const t = await jwt("mj-dup");
      const first = await app.inject({
        method: "POST",
        url: "/me/jobs/backfill",
        headers: auth(t),
      });
      expect(first.statusCode).toBe(200);
      const second = await app.inject({
        method: "POST",
        url: "/me/jobs/backfill",
        headers: auth(t),
      });
      expect(second.statusCode).toBe(409);
      expect(second.json()).toMatchObject({ error: "already_in_flight" });
    } finally {
      setActiveBoss(null);
    }
    const t = await jwt("mj-nosched");
    const res = await app.inject({ method: "POST", url: "/me/jobs/backfill", headers: auth(t) });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: "scheduler_unavailable" });
  });

  it("rate-limits a user after three requests with a retry-after", async () => {
    fakeBoss();
    try {
      const t = await jwt("mj-rate");
      const codes: number[] = [];
      for (let i = 0; i < 4; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/me/jobs/backfill",
          headers: auth(t),
          payload: { retryDeadFeeds: i % 2 === 0 },
        });
        codes.push(res.statusCode);
        if (res.statusCode === 429) {
          expect(res.headers["retry-after"]).toBeDefined();
          expect(res.json()).toMatchObject({ error: "backfill_rate_limited" });
        }
      }
      expect(codes[3]).toBe(429);
    } finally {
      setActiveBoss(null);
    }
  });
});
