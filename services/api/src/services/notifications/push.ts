import { eq, inArray } from "drizzle-orm";
import { sendNotification } from "web-push";
import { pushSubscriptions } from "@portfolio/db";
import type { getDb } from "../../db/client.js";
import type { EncryptionService } from "../encryption.js";

type Db = ReturnType<typeof getDb>;

export interface PushConfig {
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Same-origin path the notification opens (e.g. `/holdings`). Anything else becomes `/`. */
  url?: string;
  /** A newer notification with the same tag replaces the older one instead of stacking. */
  tag?: string;
}

export interface StoredSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Sends one encrypted push; injectable so tests never touch the network. */
export type PushSender = (
  subscription: StoredSubscription,
  body: string,
  config: PushConfig,
) => Promise<void>;

export const defaultSender: PushSender = async (subscription, body, config) => {
  await sendNotification(subscription, body, {
    TTL: 60 * 60 * 24,
    vapidDetails: {
      subject: config.VAPID_SUBJECT,
      publicKey: config.VAPID_PUBLIC_KEY,
      privateKey: config.VAPID_PRIVATE_KEY,
    },
  });
};

/** Push is on only when the whole VAPID triple is configured. */
export function pushEnabled(config: PushConfig): boolean {
  return Boolean(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY && config.VAPID_SUBJECT);
}

// The server POSTs to the subscription endpoint, so a user-supplied URL must be a real push
// service, never an arbitrary (internal) host. These are the endpoints browsers hand out:
// FCM (Chrome, Edge, Brave, Opera), Mozilla autopush, Apple web push and Windows WNS.
const PUSH_HOST_SUFFIXES = [
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "push.apple.com",
  "notify.windows.com",
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** The service worker opens this on click; only a same-origin path is ever allowed. */
export function safePath(url: string | undefined): string {
  if (!url || !url.startsWith("/") || url.startsWith("//") || url.includes("\\")) return "/";
  return url;
}

interface Logger {
  warn: (obj: object, msg?: string) => void;
  info: (obj: object, msg?: string) => void;
}

export interface NotifyDeps {
  db: Db;
  encryption: EncryptionService;
  config: PushConfig;
  log: Logger;
  sender?: PushSender;
}

/**
 * Best-effort fan-out to every device a user enabled notifications on. Never throws: a
 * notification must not fail the sync, job or request that raised it. A subscription the push
 * service reports gone (404/410) is deleted so it is not retried forever.
 */
export async function notifyUser(
  deps: NotifyDeps,
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; pruned: number }> {
  const { db, encryption, config, log } = deps;
  const none = { sent: 0, pruned: 0 };
  if (!pushEnabled(config) || !encryption.isEnabled) return none;
  const send = deps.sender ?? defaultSender;

  try {
    const rows = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
    if (rows.length === 0) return none;

    const body = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: safePath(payload.url),
      tag: payload.tag,
    });
    const gone: string[] = [];
    const ok: string[] = [];
    await Promise.all(
      rows.map(async (row) => {
        try {
          await send(
            {
              endpoint: row.endpoint,
              keys: {
                p256dh: encryption.decryptString(row.p256dhEnc),
                auth: encryption.decryptString(row.authEnc),
              },
            },
            body,
            config,
          );
          ok.push(row.id);
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) gone.push(row.id);
          else log.warn({ err, status }, "web push send failed");
        }
      }),
    );
    if (gone.length > 0) {
      await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
    }
    if (ok.length > 0) {
      await db
        .update(pushSubscriptions)
        .set({ lastSuccessAt: new Date() })
        .where(inArray(pushSubscriptions.id, ok));
    }
    return { sent: ok.length, pruned: gone.length };
  } catch (err) {
    log.warn({ err }, "web push notify failed");
    return none;
  }
}

/** The app-level dependencies `notifyUser` needs, for callers that hold the Fastify instance. */
export function pushDeps(
  app: {
    db: Db;
    encryption: EncryptionService;
    config: PushConfig;
    log: Logger;
    pushSender: PushSender;
  },
  log: Logger = app.log,
): NotifyDeps {
  return {
    db: app.db,
    encryption: app.encryption,
    config: app.config,
    log,
    sender: app.pushSender,
  };
}
