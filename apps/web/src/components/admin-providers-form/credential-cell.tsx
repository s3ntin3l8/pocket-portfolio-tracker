"use client";

import { ShieldOff } from "lucide-react";
import type { AdminProvider } from "@portfolio/api-client";

/** Keyless / always-available providers (e.g. Yahoo Finance): no key anywhere yet the
 *  provider still works. `configured` stays true with no stored/env key only when a key
 *  isn't required — a key-requiring provider with no key reports `configured: false`. */
export function isKeylessProvider(
  provider: Pick<AdminProvider, "keySource" | "configured" | "hasKey">,
) {
  return provider.keySource === null && provider.configured && !provider.hasKey;
}

/** Whether the inline credential editor (pencil / "Set API key" pill) should be offered
 *  at all — never for a keyless provider, and never without encryption to store a key in. */
export function canEditCredential(provider: AdminProvider, encryptionEnabled: boolean) {
  return !isKeylessProvider(provider) && encryptionEnabled;
}

/**
 * The row's key/usage sub-line (design: `{{ p.keyText }} · {{ p.usage }}`). Real states
 * the static mock doesn't model — keyless providers, encryption disabled — take over the
 * leading key-text portion instead of the plain key text, matching the old
 * `CredentialCell`'s behavior; `usage` (a separate table column in the old layout) always
 * still appends after, regardless of which key-state branch is showing.
 */
export function ProviderKeySubline({
  provider,
  encryptionEnabled,
  usage,
  t,
}: {
  provider: AdminProvider;
  encryptionEnabled: boolean;
  /** Rendered after the key text, separated by " · " (omitted if null). */
  usage?: React.ReactNode;
  t: (key: string) => string;
}) {
  let keyNode: React.ReactNode;
  if (isKeylessProvider(provider)) {
    keyNode = <span className="font-mono">{t("keyNotNeeded")}</span>;
  } else if (!encryptionEnabled) {
    keyNode = (
      <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        {provider.keySource === "env" && <span className="font-mono">{t("keyFromEnv")}</span>}
        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
          <ShieldOff className="size-3 shrink-0" />
          {t("encryptionDisabled")}
        </span>
      </span>
    );
  } else {
    const keyText = provider.hasKey
      ? provider.keyHint
      : provider.keySource === "env"
        ? t("keyFromEnv")
        : t("keyNone");
    // Only the key text is monospace (design: `<span style="font-family:monospace">
    // {keyText}</span> · {usage}`) — usage stays in the row's normal font.
    keyNode = <span className="font-mono">{keyText}</span>;
  }

  return (
    <>
      {keyNode}
      {usage != null && (
        <>
          {" · "}
          {usage}
        </>
      )}
    </>
  );
}
