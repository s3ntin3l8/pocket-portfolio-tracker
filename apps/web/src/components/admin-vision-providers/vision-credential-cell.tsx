"use client";

import { ShieldOff } from "lucide-react";
import type { AdminVisionProvider } from "@portfolio/api-client";

/** Ollama (and any future local/self-hosted provider) is URL-based — edits a URL, not an
 *  API key. */
export function isUrlProvider(provider: Pick<AdminVisionProvider, "id">) {
  return provider.id === "ollama";
}

export function hasVisionCredential(provider: AdminVisionProvider) {
  return isUrlProvider(provider) ? provider.hasUrl : provider.hasKey;
}

/** Unlike data providers, every vision provider needs *some* credential (key or URL) —
 *  there's no keyless state. Also unlike the old assumption here, `PUT
 *  /admin/vision-providers/:id/credential` requires `encryption.isEnabled` unconditionally
 *  server-side (`services/api/src/routes/admin/vision-providers.ts`) — it 503s on a URL-only
 *  write too, not just an API-key one — so this can't waive the check for URL providers. */
export function canEditVisionCredential(encryptionEnabled: boolean) {
  return encryptionEnabled;
}

/**
 * The row's key-state sub-line. Vision providers have no per-provider "model" or usage
 * data from the real API (the design mock's `model`/`usage` fields are fixture-only), so
 * unlike `ProviderKeySubline` this only ever renders the key/URL state.
 */
export function VisionKeySubline({
  provider,
  encryptionEnabled,
  t,
}: {
  provider: AdminVisionProvider;
  encryptionEnabled: boolean;
  t: (key: string) => string;
}) {
  const isUrl = isUrlProvider(provider);

  if (!encryptionEnabled) {
    return (
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        {provider.keySource === "env" && <span className="font-mono">{t("keyFromEnv")}</span>}
        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
          <ShieldOff className="size-3 shrink-0" />
          {t("encryptionDisabled")}
        </span>
      </span>
    );
  }

  const keyText = hasVisionCredential(provider)
    ? (provider.keyHint ?? (isUrl ? t("visionUrlSet") : "••••"))
    : provider.keySource === "env"
      ? t("keyFromEnv")
      : t("keyNone");

  return <span className="font-mono">{keyText}</span>;
}
