import { notifyUser } from "./push.js";
import type { NotifyDeps } from "./push.js";

/**
 * Sent once when a sync finds the Trade Republic login has expired (a login lasts 24 h and syncing
 * does not extend it, so this is a daily event). Tapping it opens Holdings, where the expired
 * banner offers a one-tap Renew. Best-effort like every `notifyUser` call.
 */
export async function notifyTrLoginExpired(deps: NotifyDeps, userId: string): Promise<void> {
  await notifyUser(deps, userId, {
    title: "Trade Republic login expired",
    body: "Syncing is paused. Tap to renew it in the Trade Republic app.",
    url: "/holdings",
    tag: "tr-login",
  });
}
