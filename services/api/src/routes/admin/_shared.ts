import type { FastifyInstance } from "fastify";
import { providerSettings, providerCredentials } from "@portfolio/db";
import {
  PROVIDER_REGISTRY,
  resolveProviderConfig,
  resolveCredentials,
  flushUsage,
  getProviderUsage,
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
    return { ...p, hasKey, keyHint, hasUrl, keySource, usage: usage[p.id] ?? null };
  });
}

export function providersResponse(
  app: FastifyInstance,
  providers: Awaited<ReturnType<typeof listProviders>>,
) {
  return { providers, encryptionEnabled: app.encryption.isEnabled };
}
