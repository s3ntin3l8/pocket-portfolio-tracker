import type { FastifyInstance } from "fastify";
import { providerSettings, providerCredentials } from "@portfolio/db";
import {
  PROVIDER_REGISTRY,
  resolveProviderConfig,
  resolveCredentials,
  flushUsage,
  getProviderUsage,
  getMarketData,
} from "../../services/market-data.js";

export async function listProviders(app: FastifyInstance) {
  const [rows, credRows] = await Promise.all([
    app.db
      .select({
        provider: providerSettings.provider,
        enabled: providerSettings.enabled,
        priority: providerSettings.priority,
      })
      .from(providerSettings),
    app.db
      .select({
        provider: providerCredentials.provider,
        apiKeyEnc: providerCredentials.apiKeyEnc,
        urlOverride: providerCredentials.urlOverride,
      })
      .from(providerCredentials),
  ]);

  const credMap = new Map<string, { apiKeyEnc: string | null; urlOverride: string | null }>(
    credRows.map((r) => [r.provider, r]),
  );
  const credentials = await resolveCredentials();

  await flushUsage();
  const usage = await getProviderUsage();
  // Providers the circuit breaker is currently skipping (quota/rate limit), with when
  // they are retried — otherwise a tripped provider just looks idle.
  // Informational only: if the provider chain can't be built, the page you use to fix the
  // provider config must still load.
  let pausedUntil = new Map<string, string>();
  try {
    pausedUntil = new Map(
      (await getMarketData()).getBlockedProviders().map((b) => [b.provider, b.until.toISOString()]),
    );
  } catch (err) {
    // Still visible in the logs: a broken chain must not look like "nothing paused".
    console.warn(
      `[admin] could not read paused providers: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return resolveProviderConfig(rows, PROVIDER_REGISTRY, credentials).map((p) => {
    const cred = credMap.get(p.id);
    const hasKey = Boolean(cred?.apiKeyEnc);
    let keyHint: string | null = null;
    if (hasKey && cred?.apiKeyEnc) {
      try {
        const plain = app.encryption.decryptString(cred.apiKeyEnc);
        keyHint = plain.length >= 4 ? `••••${plain.slice(-4)}` : "••••";
      } catch {
        keyHint = "••••";
      }
    }
    const hasUrl = Boolean(cred?.urlOverride);
    const desc = PROVIDER_REGISTRY.find((d) => d.id === p.id);
    const keySource: "db" | "env" | null =
      hasKey || hasUrl ? "db" : desc?.keyEnvVar && process.env[desc.keyEnvVar] ? "env" : null;
    return {
      ...p,
      hasKey,
      keyHint,
      hasUrl,
      keySource,
      usage: usage[p.id] ?? null,
      pausedUntil: pausedUntil.get(p.id) ?? null,
    };
  });
}

export function providersResponse(
  app: FastifyInstance,
  providers: Awaited<ReturnType<typeof listProviders>>,
) {
  return { providers, encryptionEnabled: app.encryption.isEnabled };
}
