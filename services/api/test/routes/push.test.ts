import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { generateKeyPair, SignJWT } from "jose";
import { pushSubscriptions } from "@portfolio/db";
import { buildApp } from "../../src/app.js";
import { getDb, closeDb } from "../../src/db/client.js";
import { isAllowedPushEndpoint, safePath } from "../../src/services/notifications/push.js";
import type { PushSender } from "../../src/services/notifications/push.js";

const ISSUER = "https://auth.test/o/p/";
const AUDIENCE = "portfolio-tracker";
const FCM = "https://fcm.googleapis.com/fcm/send/";

type App = Awaited<ReturnType<typeof buildApp>>;
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
const sub = (id: string) => ({
  endpoint: `${FCM}${id}`,
  keys: { p256dh: "BPUBKEY", auth: "AUTHSEC" },
});

describe("push endpoint allowlist", () => {
  it("accepts real push services and refuses everything else", () => {
    expect(isAllowedPushEndpoint(`${FCM}abc`)).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(
      true,
    );
    expect(isAllowedPushEndpoint("https://web.push.apple.com/x")).toBe(true);
    expect(isAllowedPushEndpoint("https://db5p.notify.windows.com/?token=x")).toBe(true);
    for (const bad of [
      "http://fcm.googleapis.com/x",
      "https://evil.example/x",
      "https://fcm.googleapis.com.evil.example/x",
      "https://169.254.169.254/latest",
      "https://localhost/x",
      "https://user:pw@fcm.googleapis.com/x", // pragma: allowlist secret
      "https://fcm.googleapis.com:8443/x",
      "not a url",
    ]) {
      expect(isAllowedPushEndpoint(bad), bad).toBe(false);
    }
  });

  it("only lets a notification open a same-origin path", () => {
    expect(safePath("/holdings")).toBe("/holdings");
    for (const bad of [undefined, "", "https://evil.example", "//evil.example", "/\\evil"]) {
      expect(safePath(bad)).toBe("/");
    }
  });
});

describe("Web Push routes (configured)", () => {
  let app: App;
  const sent: { endpoint: string; keys: { p256dh: string; auth: string }; body: string }[] = [];
  let failWith: number | null = null;
  const sender: PushSender = async (subscription, body) => {
    if (failWith) throw Object.assign(new Error("push failed"), { statusCode: failWith });
    sent.push({ ...subscription, body });
  };

  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.DB_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64url");
    process.env.VAPID_PUBLIC_KEY = "BPublicKeyForTests";
    process.env.VAPID_PRIVATE_KEY = "private-key-for-tests"; // pragma: allowlist secret
    process.env.VAPID_SUBJECT = "mailto:ops@example.invalid";
    app = await buildApp({ authKey: kp.publicKey, pushSender: sender });
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    for (const k of [
      "AUTHENTIK_ISSUER",
      "AUTHENTIK_AUDIENCE",
      "DB_ENCRYPTION_KEY",
      "VAPID_PUBLIC_KEY",
      "VAPID_PRIVATE_KEY",
      "VAPID_SUBJECT",
    ]) {
      delete process.env[k];
    }
  });

  const post = (t: string, payload: object) =>
    app.inject({ method: "POST", url: "/me/push/subscriptions", headers: auth(t), payload });

  it("publishes the VAPID public key when push is configured", async () => {
    const t = await token("push-config");
    const res = await app.inject({ method: "GET", url: "/me/push/config", headers: auth(t) });
    expect(res.json()).toEqual({ enabled: true, publicKey: "BPublicKeyForTests" });
  });

  it("stores a subscription with its keys encrypted, and is idempotent per endpoint", async () => {
    const t = await token("push-store");
    expect((await post(t, sub("store"))).statusCode).toBe(201);
    expect((await post(t, sub("store"))).statusCode).toBe(201);

    const rows = await getDb()
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, `${FCM}store`));
    expect(rows).toHaveLength(1);
    expect(rows[0].p256dhEnc).toMatch(/^enc:/);
    expect(rows[0].authEnc).toMatch(/^enc:/);
    expect(rows[0].authEnc).not.toContain("AUTHSEC");
  });

  it("refuses a subscription whose endpoint is not a push service", async () => {
    const t = await token("push-ssrf");
    for (const endpoint of ["https://169.254.169.254/x", "http://fcm.googleapis.com/x", "nope"]) {
      const res = await post(t, { endpoint, keys: { p256dh: "a", auth: "b" } });
      expect(res.statusCode, endpoint).toBe(400);
      expect(res.json()).toEqual({ error: "invalid_subscription" });
    }
    expect((await post(t, { endpoint: `${FCM}x` })).statusCode).toBe(400);
  });

  it("moves an endpoint to the user who signs in on that browser last", async () => {
    const a = await token("push-move-a");
    const b = await token("push-move-b");
    await post(a, sub("shared"));
    await post(b, sub("shared"));
    const rows = await getDb()
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, `${FCM}shared`));
    expect(rows).toHaveLength(1);
    const bTest = await app.inject({ method: "POST", url: "/me/push/test", headers: auth(b) });
    expect(bTest.json()).toEqual({ sent: 1 });
    const aTest = await app.inject({ method: "POST", url: "/me/push/test", headers: auth(a) });
    expect(aTest.statusCode).toBe(409);
  });

  it("keeps only the newest 10 subscriptions per user", async () => {
    const t = await token("push-cap");
    for (let i = 0; i < 12; i++) await post(t, sub(`cap-${i}`));
    const count = async () =>
      (await getDb().select({ e: pushSubscriptions.endpoint }).from(pushSubscriptions)).filter(
        (r) => r.e.includes("/cap-"),
      ).length;
    expect(await count()).toBe(10);
  });

  it("deletes only the caller's own subscription", async () => {
    const owner = await token("push-del-owner");
    const other = await token("push-del-other");
    await post(owner, sub("del"));
    const wrong = await app.inject({
      method: "DELETE",
      url: `/me/push/subscriptions?endpoint=${encodeURIComponent(`${FCM}del`)}`,
      headers: auth(other),
    });
    expect(wrong.statusCode).toBe(204);
    const still = await getDb()
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, `${FCM}del`));
    expect(still).toHaveLength(1);

    await app.inject({
      method: "DELETE",
      url: `/me/push/subscriptions?endpoint=${encodeURIComponent(`${FCM}del`)}`,
      headers: auth(owner),
    });
    const gone = await getDb()
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, `${FCM}del`));
    expect(gone).toHaveLength(0);
  });

  it("sends a test push with the decrypted keys and a same-origin url", async () => {
    const t = await token("push-test");
    await post(t, sub("test-send"));
    sent.length = 0;
    const res = await app.inject({ method: "POST", url: "/me/push/test", headers: auth(t) });
    expect(res.json()).toEqual({ sent: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].keys).toEqual({ p256dh: "BPUBKEY", auth: "AUTHSEC" });
    expect(JSON.parse(sent[0].body)).toMatchObject({ title: "Pocket", url: "/", tag: "test" });
  });

  it("rate-limits test pushes to 5 per hour with a retry-after", async () => {
    const t = await token("push-rate");
    await post(t, sub("rate"));
    const test = () => app.inject({ method: "POST", url: "/me/push/test", headers: auth(t) });
    for (let i = 0; i < 5; i++) expect((await test()).statusCode).toBe(200);
    const sixth = await test();
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json()).toEqual({ error: "push_test_rate_limited" });
    expect(Number(sixth.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("409s a test push when the user has no device", async () => {
    const t = await token("push-test-none");
    const res = await app.inject({ method: "POST", url: "/me/push/test", headers: auth(t) });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "no_subscriptions" });
  });

  it("prunes a subscription the push service reports gone, and keeps one that merely failed", async () => {
    const t = await token("push-prune");
    await post(t, sub("prune"));
    const endpoint = `${FCM}prune`;
    const exists = async () =>
      (
        await getDb()
          .select()
          .from(pushSubscriptions)
          .where(eq(pushSubscriptions.endpoint, endpoint))
      ).length;

    failWith = 500;
    const flaky = await app.inject({ method: "POST", url: "/me/push/test", headers: auth(t) });
    expect(flaky.json()).toEqual({ sent: 0 });
    expect(await exists()).toBe(1);

    failWith = 410;
    await app.inject({ method: "POST", url: "/me/push/test", headers: auth(t) });
    failWith = null;
    expect(await exists()).toBe(0);
  });
});

describe("Web Push routes (not configured)", () => {
  let app: App;

  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.DB_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64url");
    app = await buildApp({ authKey: kp.publicKey });
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    delete process.env.AUTHENTIK_ISSUER;
    delete process.env.AUTHENTIK_AUDIENCE;
    delete process.env.DB_ENCRYPTION_KEY;
  });

  it("reports push as off and refuses to register a device", async () => {
    const t = await token("push-off");
    const cfg = await app.inject({ method: "GET", url: "/me/push/config", headers: auth(t) });
    expect(cfg.json()).toEqual({ enabled: false, publicKey: null });
    const res = await app.inject({
      method: "POST",
      url: "/me/push/subscriptions",
      headers: auth(t),
      payload: sub("off"),
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "push_not_configured" });
  });
});
