import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { pushSubscriptions, users } from "@portfolio/db";
import { ensureDb, closeDb } from "../../src/db/client.js";
import { EncryptionService } from "../../src/services/encryption.js";
import { notifyTrLoginExpired } from "../../src/services/notifications/tr-session.js";
import type { NotifyDeps, PushSender } from "../../src/services/notifications/push.js";

const enc = new EncryptionService({ key: crypto.randomBytes(32).toString("base64url") });
const config = {
  VAPID_PUBLIC_KEY: "pub",
  VAPID_PRIVATE_KEY: "priv", // pragma: allowlist secret
  VAPID_SUBJECT: "mailto:ops@example.invalid",
};

describe("notifyTrLoginExpired", () => {
  const sent: string[] = [];
  let deps: NotifyDeps;
  let userId: string;

  beforeAll(async () => {
    const db = await ensureDb();
    const sender: PushSender = async (_sub, body) => {
      sent.push(body);
    };
    deps = {
      db,
      encryption: enc,
      config,
      log: { warn: () => undefined, info: () => undefined },
      sender,
    };
    const [user] = await db
      .insert(users)
      .values({ authSub: "tr-expired-notify|u", email: "tr-expired-notify@example.com" })
      .returning();
    userId = user.id;
    await db.insert(pushSubscriptions).values({
      userId,
      endpoint: "https://fcm.googleapis.com/fcm/send/tr-expired",
      p256dhEnc: enc.encryptString("p"),
      authEnc: enc.encryptString("a"),
    });
  });
  afterAll(async () => {
    await closeDb();
  });

  it("pushes a tap-to-renew message that opens Holdings and replaces an older one (same tag)", async () => {
    await notifyTrLoginExpired(deps, userId);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0])).toMatchObject({
      title: "Trade Republic login expired",
      url: "/holdings",
      tag: "tr-login",
    });
  });

  it("does nothing for a user with no registered device", async () => {
    sent.length = 0;
    const db = await ensureDb();
    const [other] = await db
      .insert(users)
      .values({ authSub: "tr-expired-notify|none", email: "tr-expired-none@example.com" })
      .returning();
    await notifyTrLoginExpired(deps, other.id);
    expect(sent).toHaveLength(0);
  });
});
