"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ShieldCheck } from "lucide-react";
import type { ApiClient, IntegrityFinding, IntegrityReport } from "@portfolio/api-client";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Spinner } from "@/components/ui/spinner";
import { formatDateTime } from "@/lib/utils";

/** The slice of the API client this panel needs (injectable for tests). */
export type IntegrityCheckClient = Pick<ApiClient, "getIntegrityReport">;

type State =
  | { status: "idle" }
  | { status: "running" }
  // A failed run is NOT "no findings": it gets its own state and message, never the all-clear.
  | { status: "error" }
  | { status: "done"; report: IntegrityReport };

/**
 * Settings › Data & connections › Data checks: runs the same consistency checks as
 * `npm run integrity` (docs/integrity.md) on demand. A finding is evidence that two figures
 * disagree (rule, scope, expected vs actual), not a verdict on which one is wrong, so the
 * panel shows the numbers as the API reports them and never recomputes or "fixes" them.
 */
export function IntegrityCheckPanel({ client }: { client: IntegrityCheckClient }) {
  const t = useTranslations("Settings");
  const locale = useLocale();
  const [state, setState] = useState<State>({ status: "idle" });

  async function run() {
    if (state.status === "running") return;
    setState({ status: "running" });
    try {
      setState({ status: "done", report: await client.getIntegrityReport() });
    } catch {
      setState({ status: "error" });
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("integrityHint")}</p>

      <div className="flex items-center gap-3">
        <Button onClick={run} disabled={state.status === "running"}>
          {state.status === "running" ? (
            <>
              <Spinner className="mr-2 size-4" />
              {t("integrityRunning")}
            </>
          ) : state.status === "idle" ? (
            t("integrityRun")
          ) : (
            t("integrityRerun")
          )}
        </Button>
        {state.status === "done" && (
          <span className="text-xs text-muted-foreground">
            {t("integrityCheckedAt", { when: formatDateTime(state.report.checkedAt, locale) })}
          </span>
        )}
      </div>

      <div aria-live="polite" className="space-y-3">
        {state.status === "error" && <ErrorBanner>{t("integrityError")}</ErrorBanner>}

        {state.status === "done" && state.report.findings.length === 0 && (
          <p className="flex items-center gap-2 text-sm">
            <ShieldCheck className="size-4 shrink-0 text-positive" aria-hidden />
            {t("integrityOk", {
              rules: state.report.rulesRun.length,
              portfolios: state.report.portfolioCount,
            })}
          </p>
        )}

        {state.status === "done" && state.report.findings.length > 0 && (
          <>
            <p className="text-sm font-bold">
              {t("integrityFound", { count: state.report.findings.length })}
            </p>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {state.report.findings.map((f, i) => (
                <li key={`${f.rule}:${f.scope}:${i}`} className="space-y-1 px-4 py-3">
                  <p className="text-sm font-bold">{ruleText(t, f)}</p>
                  <p className="text-xs text-muted-foreground">
                    {scopeText(t, f.scope)}
                    <span className="mx-1.5" aria-hidden>
                      ·
                    </span>
                    <code>{f.rule}</code>
                  </p>
                  <dl className="grid grid-cols-3 gap-2 text-xs">
                    <Figure label={t("integrityExpected")} value={f.expected} />
                    <Figure label={t("integrityActual")} value={f.actual} />
                    <Figure label={t("integrityDiff")} value={f.diff} />
                  </dl>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      {/* The API's own string, untouched: evidence is shown, not recomputed. */}
      <dd className="truncate font-mono tabular-nums" title={value}>
        {value}
      </dd>
    </div>
  );
}

type T = ReturnType<typeof useTranslations>;

/** The rule's plain-language meaning; a rule the web does not know yet falls back to the API's text. */
function ruleText(t: T, f: IntegrityFinding): string {
  const key = `integrityRule_${f.rule}`;
  return t.has(key) ? t(key) : f.message;
}

function scopeText(t: T, scope: string): string {
  if (scope === "networth") return t("integrityScopeNetworth");
  return t("integrityScopePortfolio", { id: scope.replace(/^portfolio:/, "").slice(0, 8) });
}
