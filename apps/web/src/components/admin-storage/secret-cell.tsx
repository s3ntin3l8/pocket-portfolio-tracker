"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Pencil } from "lucide-react";
import type { StorageSecretInput } from "@portfolio/api-client";
import { CredentialEditorPanel } from "@/components/admin/credential-editor-panel";
import { SourceBadge } from "./source-badge";

/**
 * The S3 secret access key — write-only and masked, same shape as a provider API key, so
 * it reuses the B1 inline `CredentialEditorPanel` (pencil / "Set" pill → expanding editor)
 * rather than the design's plain always-visible password field: the design's static state
 * model treats the secret as just another form field saved with everything else, but the
 * real API keeps it a distinct write-only PUT/DELETE endpoint (never returned to the
 * client), which needs the same two-step open/save/clear flow every other credential here
 * uses — not a field that silently saves on the next general "Save settings" click.
 */
export function SecretCell({
  encryptionEnabled,
  hasSecret,
  secretHint,
  secretSource,
  onSet,
  onClear,
}: {
  encryptionEnabled: boolean;
  hasSecret: boolean;
  secretHint: string;
  secretSource: "db" | "env"; // pragma: allowlist secret
  onSet: (body: StorageSecretInput) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const t = useTranslations("Admin");
  const [editing, setEditing] = useState(false);

  if (!encryptionEnabled) {
    return (
      <div className="space-y-1.5">
        <label className="block px-0.5 text-xs font-semibold text-text-2">
          {t("storageSecretKey")}
        </label>
        <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <AlertCircle className="size-3 shrink-0" />
          {t("storageEncryptionRequired")}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-1 px-0.5">
        <label className="text-xs font-semibold text-text-2">{t("storageSecretKey")}</label>
        <SourceBadge source={secretSource} />
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate rounded-[12px] border border-border bg-background px-3 py-2 font-mono text-sm text-muted-foreground">
          {hasSecret ? secretHint : t("storageSecretNone")}
        </span>
        {hasSecret ? (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-label={t("editCredential")}
            className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-background text-text-2 hover:text-foreground"
          >
            <Pencil className="size-[15px]" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="shrink-0 whitespace-nowrap rounded-[9px] bg-primary/10 px-2.5 py-2 text-[11px] font-bold text-primary"
          >
            {t("credentialSet")}
          </button>
        )}
      </div>
      {editing && (
        <div className="mt-2">
          <CredentialEditorPanel
            label={t("storageSecretKey")}
            hasCredential={hasSecret}
            onSave={(apiKey) => onSet({ apiKey })}
            onClear={onClear}
            onClose={() => setEditing(false)}
          />
        </div>
      )}
    </div>
  );
}
