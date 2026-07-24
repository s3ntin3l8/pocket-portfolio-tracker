"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import type { ApiClient, ImportStrategy } from "@portfolio/api-client";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** The slice of the API client this form needs (injectable for tests). */
export type AdminImportSettingsClient = Pick<ApiClient, "updateAdminImportSettings">;

const STRATEGIES: ImportStrategy[] = ["parser_first", "vision_only"];

/**
 * Picks the first-choice extraction strategy for the unstructured import path
 * (screenshots + PDFs). "parser_first" runs the deterministic broker parser before the
 * vision-LLM; "vision_only" always uses the vision-LLM. CSV imports are unaffected.
 *
 * Design (`Admin Settings.dc.html`): one `rounded-[20px]` card holding both options as
 * radio rows — selecting a row saves immediately (no separate Save button). Optimistic:
 * the selection flips right away and rolls back on a failed save, rather than waiting on
 * the request before reflecting the choice.
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function select(next: ImportStrategy) {
    if (next === strategy || busy) return;
    const previous = strategy;
    setStrategy(next);
    setBusy(true);
    setError(false);
    try {
      const { strategy: saved } = await client.updateAdminImportSettings({ strategy: next });
      setStrategy(saved);
      onSuccess?.();
    } catch {
      setStrategy(previous);
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertCircle className="size-4 shrink-0" />
          {t("importStrategyError")}
        </div>
      )}

      <Label id="import-strategy-label" className="block px-0.5">
        {t("importStrategyLabel")}
      </Label>
      <div
        role="radiogroup"
        aria-labelledby="import-strategy-label"
        className="overflow-hidden rounded-[20px] bg-card shadow-card"
      >
        {STRATEGIES.map((s, i) => {
          const active = strategy === s;
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={busy}
              onClick={() => select(s)}
              className={cn(
                "flex w-full items-start gap-[13px] px-[15px] py-4 text-left transition-colors disabled:cursor-default",
                i > 0 && "border-t border-line",
                !busy && "hover:bg-background/40",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "mt-px flex size-[22px] shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                  active ? "border-primary" : "border-border",
                )}
              >
                {active && <span className="size-[11px] rounded-full bg-primary" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">{t(`importStrategyOption_${s}`)}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                  {t(`importStrategyHint_${s}`)}
                </span>
              </span>
              {busy && active && <Spinner size="sm" className="mt-0.5 shrink-0" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
