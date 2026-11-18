"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { useApiClient } from "@/lib/api";
import { useRouter } from "@/i18n/navigation";
import { useAssistant } from "@/components/assistant/assistant-provider";
import { Switch } from "@/components/ui/switch";

/**
 * Opt-in for attaching documents to the assistant chat. Off by default. A document goes to the
 * chat provider as it is (account numbers, IBANs and names included, unlike the tool results), so
 * the warning names where it goes: the provider, or the user's own server for a local one. Turning
 * it off needs no confirmation: nothing is stored.
 */
export function AssistantAttachmentsToggle({ enabled }: { enabled: boolean }) {
  const t = useTranslations("Settings");
  const api = useApiClient();
  const router = useRouter();
  const { status } = useAssistant();
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const labelId = useId();
  const warningId = useId();

  async function save(next: boolean) {
    setBusy(true);
    setError(false);
    try {
      await api.putPreferences({ assistantAttachments: next });
      setOn(next);
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const warning = status?.local
    ? t("assistantAttachmentsWarningLocal")
    : status?.label
      ? t("assistantAttachmentsWarning", { provider: status.label })
      : t("assistantAttachmentsWarningGeneric");

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p id={labelId} className="text-sm font-semibold">
            {t("assistantAttachmentsLabel")}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("assistantAttachmentsHint")}</p>
        </div>
        <Switch
          checked={on}
          disabled={busy}
          aria-labelledby={labelId}
          aria-describedby={warningId}
          onCheckedChange={(next) => void save(next)}
        />
      </div>
      <p id={warningId} className="text-xs font-semibold text-text-2">
        {warning}
      </p>
      {error && (
        <p role="alert" className="text-xs font-semibold text-destructive">
          {t("assistantAttachmentsError")}
        </p>
      )}
    </div>
  );
}
