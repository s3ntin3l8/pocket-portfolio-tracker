"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import type { ApiClient, ImportStrategy } from "@portfolio/api-client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/** The slice of the API client this form needs (injectable for tests). */
export type AdminImportSettingsClient = Pick<ApiClient, "updateAdminImportSettings">;

const STRATEGIES: ImportStrategy[] = ["parser_first", "vision_only"];

/**
 * Picks the first-choice extraction strategy for the unstructured import path
 * (screenshots + PDFs). "parser_first" runs the deterministic broker parser before the
 * vision-LLM; "vision_only" always uses the vision-LLM. CSV imports are unaffected.
 */
export function AdminImportSettingsForm({
  client,
  initialStrategy,
  onSuccess,
}: {
  client: AdminImportSettingsClient;
  initialStrategy: ImportStrategy;
  onSuccess?: () => void;
}) {
  const t = useTranslations("Admin");
  const [strategy, setStrategy] = useState<ImportStrategy>(initialStrategy);
  // Baseline the form diffs against; advances on a successful save.
  const [baseStrategy, setBaseStrategy] = useState<ImportStrategy>(initialStrategy);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);

  const dirty = strategy !== baseStrategy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || busy) return;
    setBusy(true);
    setError(false);
    setSaved(false);
    try {
      const { strategy: next } = await client.updateAdminImportSettings({ strategy });
      setStrategy(next);
      setBaseStrategy(next);
      setSaved(true);
      onSuccess?.();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-md space-y-4">
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertCircle className="size-4 shrink-0" />
          {t("importStrategyError")}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="import-strategy">{t("importStrategyLabel")}</Label>
        <Select
          id="import-strategy"
          value={strategy}
          onChange={(e) => {
            setStrategy(e.target.value as ImportStrategy);
            setSaved(false);
          }}
        >
          {STRATEGIES.map((s) => (
            <option key={s} value={s}>
              {t(`importStrategyOption_${s}`)}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground">
          {t(`importStrategyHint_${strategy}`)}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy || !dirty}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {busy ? t("importStrategySaving") : t("importStrategySave")}
        </Button>
        {saved && !dirty && (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <Check className="size-4" />
            {t("importStrategySaved")}
          </span>
        )}
      </div>
    </form>
  );
}
