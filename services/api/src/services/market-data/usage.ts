import { providerUsage } from "@portfolio/db";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import {
  drainCallCounts,
  readUsageCache,
  writeUsageCache,
  USAGE_TTL_MS,
  todayKey,
  monthKey,
} from "./call-tracker.js";
import { resolveCredentials } from "./service.js";
import { PROVIDER_REGISTRY } from "./registry.js";
import type { ProviderUsageView } from "./types.js";

export async function flushUsage(): Promise<void> {
  const drained = drainCallCounts();
  if (drained.length === 0) return;
  const now = new Date();
  const day = todayKey(now);
  const month = monthKey(now);
  const db = getDb();
  for (const [provider, count] of drained) {
    const [existing] = await db
      .select()
      .from(providerUsage)
      .where(eq(providerUsage.provider, provider));
    if (!existing) {
      await db.insert(providerUsage).values({
        provider,
        day,
        callsDay: count,
        month,
        callsMonth: count,
      });
      continue;
    }
    const callsDay = (existing.day === day ? existing.callsDay : 0) + count;
    const callsMonth = (existing.month === month ? existing.callsMonth : 0) + count;
    await db
      .update(providerUsage)
      .set({ day, callsDay, month, callsMonth, updatedAt: now })
      .where(eq(providerUsage.provider, provider));
  }
}

export async function getProviderUsage(): Promise<Record<string, ProviderUsageView>> {
  const cached = readUsageCache();
  if (cached && Date.now() - cached.at < USAGE_TTL_MS) {
    return cached.data;
  }
  const out: Record<string, ProviderUsageView> = {};
  const now = new Date();
  const month = monthKey(now);

  type UsageRow = typeof providerUsage.$inferSelect;
  const [localRows, credentials] = await Promise.all([
    getDb().select().from(providerUsage) as Promise<UsageRow[]>,
    resolveCredentials(),
  ]);
  const localById = new Map(localRows.map((r) => [r.provider, r]));

  for (const d of PROVIDER_REGISTRY) {
    const secret = credentials.get(d.id);
    if (!d.configured(secret)) continue;
    let view: ProviderUsageView | null = null;

    const provider = d.create(secret);
    if (provider.getUsage) {
      const live = await provider.getUsage();
      if (live) view = { source: "provider", ...live };
    }

    if (!view) {
      const local = localById.get(d.id);
      if (local) {
        view = {
          source: "local",
          window: "month",
          used: local.month === month ? local.callsMonth : 0,
          limit: null,
        };
      }
    }

    if (view) out[d.id] = view;
  }

  writeUsageCache({ at: Date.now(), data: out });
  return out;
}
