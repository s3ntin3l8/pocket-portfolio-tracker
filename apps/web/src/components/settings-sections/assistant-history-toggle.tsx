"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { useApiClient } from "@/lib/api";
import { useRouter } from "@/i18n/navigation";
import { Switch } from "@/components/ui/switch";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";

/**
 * Opt-in for keeping assistant conversations on the server (text only). Off by default; turning
 * it off asks first because the server deletes everything stored.
 */
export function AssistantHistoryToggle({ enabled }: { enabled: boolean }) {
  const t = useTranslations("Settings");
  const api = useApiClient();
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const labelId = useId();

  async function save(next: boolean) {
    setBusy(true);
    setError(false);
    try {
      await api.putPreferences({ assistantSaveHistory: next });
      setOn(next);
      setConfirmOff(false);
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p id={labelId} className="text-sm font-semibold">
            {t("assistantHistoryLabel")}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("assistantHistoryHint")}</p>
        </div>
        <Switch
          checked={on}
          disabled={busy}
          aria-labelledby={labelId}
          onCheckedChange={(next) => (next ? void save(true) : setConfirmOff(true))}
        />
      </div>
      {error && (
        <p role="alert" className="text-xs font-semibold text-destructive">
          {t("assistantHistoryError")}
        </p>
      )}
      <ConfirmActionDialog
        open={confirmOff}
        onOpenChange={setConfirmOff}
        title={t("assistantHistoryOffTitle")}
        description={t("assistantHistoryOffBody")}
        confirmLabel={t("assistantHistoryOffConfirm")}
        variant="destructive"
        busy={busy}
        onConfirm={() => void save(false)}
      />
    </div>
  );
}
