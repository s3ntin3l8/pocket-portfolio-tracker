import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { portfolios, pushSubscriptions, trConnections, users } from "@portfolio/db";
import { ensureDb, closeDb } from "../../src/db/client.js";
import { EncryptionService } from "../../src/services/encryption.js";
import {
  notifyTrLoginExpired,
  notifyTrLoginExpiring,
  notifyTrLoginExpiringById,
} from "../../src/services/notifications/tr-session.js";
import type { NotifyDeps, PushSender } from "../../src/services/notifications/push.js";
import { RENEW_NOTIFY_WINDOW_MS } from "../../src/services/pytr/session-expiry.js";

const enc = new EncryptionService({ key: crypto.randomBytes(32).toString("base64url") });
const config = {
  VAPID_PUBLIC_KEY: "pub",
  VAPID_PRIVATE_KEY: "priv", // pragma: allowlist secret
  VAPID_SUBJECT: "mailto:ops@example.invalid",
};
const noLog = { warn: () => undefined, info: () => undefined };

const jwt = (exp: number) =>
  `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.s`;
const jar = (expMs: number) =>
  `api.traderepublic.com\tFALSE\t/api\tTRUE\t0\ttr_refresh\t${jwt(Math.floor(expMs / 1000))}`;

const NOW = new Date("2026-11-16T12:00:00.000Z");
const inMs = (ms: number) => NOW.getTime() + ms;
const HOUR = 3_600_000;

describe("Trade Republic login notifications", () => {
  const sent: { body: string }[] = [];
  let deps: NotifyDeps;

  beforeAll(async () => {
    const db = await ensureDb();
    const sender: PushSender = async (_sub, body) => {
      sent.push({ body });
    };
    deps = { db, encryption: enc, config, log: noLog, sender };
  });
  afterAll(async () => {
    await closeDb();
  });

  async function seed(sub: string, opts: { session: string | null; device?: boolean }) {
    const db = await ensureDb();
    const [user] = await db
      .insert(users)
      .values({ authSub: `tr-notify|${sub}`, email: `${sub}@example.com` })
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
        phoneEnc: enc.encryptString("+49"),
        pinEnc: enc.encryptString("1234"),
        sessionEnc: opts.session === null ? null : enc.encryptString(opts.session),
        status: "connected",
      })
      .returning();
    if (opts.device !== false) {
      await db.insert(pushSubscriptions).values({
        userId: user.id,
        endpoint: `https://fcm.googleapis.com/fcm/send/${sub}`,
        p256dhEnc: enc.encryptString("p"),
        authEnc: enc.encryptString("a"),
      });
    }
    return conn;
  }
  const reload = async (id: string) =>
    (await (await ensureDb()).select().from(trConnections).where(eq(trConnections.id, id)))[0];

  it("notifies once when the login is inside the notification window", async () => {
    const conn = await seed("inside", { session: jar(inMs(2 * HOUR)) });
    sent.length = 0;
    expect(await notifyTrLoginExpiring(deps, conn, NOW)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0].body)).toMatchObject({ url: "/holdings", tag: "tr-login" });
    expect(JSON.parse(sent[0].body).body).toMatch(/about 2 h/);

    // The hourly sweep runs again on the same connection row: no second push.
    expect(await notifyTrLoginExpiring(deps, await reload(conn.id), NOW)).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("stays quiet outside the window, after expiry, and without a readable expiry", async () => {
    sent.length = 0;
    const far = await seed("far", { session: jar(inMs(RENEW_NOTIFY_WINDOW_MS + HOUR)) });
    const past = await seed("past", { session: jar(inMs(-HOUR)) });
    const opaque = await seed("opaque", { session: "no cookies here" });
    const none = await seed("none", { session: null });
    for (const c of [far, past, opaque, none]) {
      expect(await notifyTrLoginExpiring(deps, c, NOW)).toBe(false);
    }
    expect(sent).toHaveLength(0);
  });

  it("is re-armed by a renew (a new expiry) but not by a re-run for the same one", async () => {
    const conn = await seed("rearm", { session: jar(inMs(HOUR)) });
    sent.length = 0;
    await notifyTrLoginExpiring(deps, conn, NOW);
    expect(sent).toHaveLength(1);

    // renew: new session, new expiry, marker reset by verify
    const db = await ensureDb();
    const nextDay = NOW.getTime() + 24 * HOUR;
    await db
      .update(trConnections)
      .set({ sessionEnc: enc.encryptString(jar(nextDay + HOUR)), expiryNotifiedFor: null })
      .where(eq(trConnections.id, conn.id));
    const later = new Date(nextDay);
    await notifyTrLoginExpiring(deps, await reload(conn.id), later);
    expect(sent).toHaveLength(2);
  });

  it("does not record a notification no device received, so enabling push later still gets one", async () => {
    const conn = await seed("no-device", { session: jar(inMs(HOUR)), device: false });
    sent.length = 0;
    expect(await notifyTrLoginExpiring(deps, conn, NOW)).toBe(false);
    expect((await reload(conn.id)).expiryNotifiedFor).toBeNull();

    await (await ensureDb()).insert(pushSubscriptions).values({
      userId: conn.userId,
      endpoint: "https://fcm.googleapis.com/fcm/send/no-device-late",
      p256dhEnc: enc.encryptString("p"),
      authEnc: enc.encryptString("a"),
    });
    expect(await notifyTrLoginExpiring(deps, conn, NOW)).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("sends the expired notification with the same tag so it replaces the warning", async () => {
    const conn = await seed("expired", { session: jar(inMs(-HOUR)) });
    sent.length = 0;
    await notifyTrLoginExpired(deps, conn.userId);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0].body)).toMatchObject({ tag: "tr-login", url: "/holdings" });
  });

  // The sweep's own row predates the sync it ran: a renew can finish meanwhile.
  describe("notifyTrLoginExpiringById reads the connection fresh", () => {
    it("warns for a connection that is still inside the window", async () => {
      const conn = await seed("byid-ok", { session: jar(inMs(2 * HOUR)) });
      sent.length = 0;
      expect(await notifyTrLoginExpiringById(deps, conn.id, NOW)).toBe(true);
      expect(sent).toHaveLength(1);
    });

    it("does not warn about the old expiry when a renew replaced the session meanwhile", async () => {
      // The sweep read this connection 2 h before expiry; a renew then stored a 24 h session.
      const conn = await seed("byid-renewed", { session: jar(inMs(2 * HOUR)) });
      await (
        await ensureDb()
      )
        .update(trConnections)
        .set({ sessionEnc: enc.encryptString(jar(inMs(24 * HOUR))), expiryNotifiedFor: null })
        .where(eq(trConnections.id, conn.id));
      sent.length = 0;
      expect(await notifyTrLoginExpiringById(deps, conn.id, NOW)).toBe(false);
      expect(sent).toHaveLength(0);
    });

    it("skips a connection that was deleted or is no longer connected", async () => {
      const gone = await seed("byid-gone", { session: jar(inMs(HOUR)) });
      const flipped = await seed("byid-flipped", { session: jar(inMs(HOUR)) });
      const db = await ensureDb();
      await db.delete(trConnections).where(eq(trConnections.id, gone.id));
      await db
        .update(trConnections)
        .set({ status: "error" })
        .where(eq(trConnections.id, flipped.id));
      sent.length = 0;
      expect(await notifyTrLoginExpiringById(deps, gone.id, NOW)).toBe(false);
      expect(await notifyTrLoginExpiringById(deps, flipped.id, NOW)).toBe(false);
      expect(sent).toHaveLength(0);
    });
  });
});
