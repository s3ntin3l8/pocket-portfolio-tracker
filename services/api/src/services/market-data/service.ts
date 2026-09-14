import {
  MarketDataService,
  FixtureProvider,
  OpenFigiProvider,
  type MarketDataProvider,
} from "@portfolio/market-data";
import { BorseFrankfurtProvider } from "../borse-frankfurt.js";
import { providerSettings, providerCredentials } from "@portfolio/db";
import { getDb, getEncryption } from "../../db/client.js";
import type { ProviderDescriptor, ResolvedSecret } from "./types.js";
import { PROVIDER_REGISTRY, resolveProviderConfig } from "./registry.js";
import { recordCall, clearUsageCache } from "./call-tracker.js";

let service: MarketDataService | null = null;

export async function resolveCredentials(
  registry: ProviderDescriptor[] = PROVIDER_REGISTRY,
): Promise<Map<string, ResolvedSecret>> {
  const enc = getEncryption();
  const db = getDb();
  const ids = new Set(registry.map((d) => d.id));
  type CredRow = typeof providerCredentials.$inferSelect;
  const rows = await db
    .select()
    .from(providerCredentials)
    .then((rs: CredRow[]) => rs.filter((r) => ids.has(r.provider)));

  const out = new Map<string, ResolvedSecret>();
  for (const row of rows) {
    const secret: ResolvedSecret = {};
    if (row.apiKeyEnc) {
      try {
        secret.apiKey = enc.decryptString(row.apiKeyEnc);
      } catch {
        // Decryption failure: skip this key; env will act as fallback
      }
    }
    if (row.urlOverride) {
      secret.url = row.urlOverride;
    }
    if (secret.apiKey !== undefined || secret.url !== undefined) {
      out.set(row.provider, secret);
    }
  }
  return out;
}

export async function getMarketData(): Promise<MarketDataService> {
  if (service) return service;
  const providers: MarketDataProvider[] = [];
  if (process.env.NODE_ENV !== "test") {
    const db = getDb();
    const [rows, credentials] = await Promise.all([
      db
        .select({
          provider: providerSettings.provider,
          enabled: providerSettings.enabled,
          priority: providerSettings.priority,
        })
        .from(providerSettings),
      resolveCredentials(),
    ]);
    const byId = new Map(PROVIDER_REGISTRY.map((d) => [d.id, d]));
    for (const r of resolveProviderConfig(rows, PROVIDER_REGISTRY, credentials)) {
      if (!r.enabled || !r.configured) continue;
      providers.push(byId.get(r.id)!.create(credentials.get(r.id)));
    }
    providers.push(new OpenFigiProvider({ apiKey: process.env.OPENFIGI_API_KEY }));
  }
  providers.push(new FixtureProvider());
  service = new MarketDataService(providers, {
    onCall: recordCall,
    // A provider error covered by a fallback is invisible to the caller (#749) —
    // log at warn level so a primary outage covered by a fallback is operationally
    // visible. Plain console.warn rather than pino: this file has no logger threaded
    // through it (getMarketData() is called from scheduler/test contexts that don't
    // share a request-scoped logger), and the line carries enough context to be
    // grep-able on its own.
    onProviderError: (provider, method, err) =>
      console.warn(
        `[market-data] ${provider}.${method} failed; falling back: ${err instanceof Error ? err.message : String(err)}`,
      ),
  });
  return service;
}

export function getBorseFrankfurt(): BorseFrankfurtProvider | null {
  if (process.env.BORSE_FRANKFURT_ENABLED !== "true") return null;
  return new BorseFrankfurtProvider();
}

export function invalidateMarketData(): void {
  service = null;
  clearUsageCache();
}

export function overrideMarketData(svc: MarketDataService): void {
  service = svc;
}
