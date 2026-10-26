"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Info, ShieldCheck } from "lucide-react";
import type {
  ApiClient,
  IntegrityAbstention,
  IntegrityFinding,
  IntegrityReport,
} from "@portfolio/api-client";
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
            {/* The green shield is only for "nothing found AND nothing skipped"; an older server
                that does not report skips, or any skip, gets a neutral icon instead. */}
            {state.report.abstentions?.length === 0 ? (
              <ShieldCheck className="size-4 shrink-0 text-success" aria-hidden />
            ) : (
              <Info className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
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

        {state.status === "done" && (state.report.abstentions?.length ?? 0) > 0 && (
          <Skipped t={t} abstentions={state.report.abstentions!} />
        )}
      </div>
    </div>
  );
}

/**
 * Where a rule skipped data instead of comparing it. Those scopes are not known to be consistent,
 * so they are listed, never folded into the all-clear.
 */
function Skipped({ t, abstentions }: { t: T; abstentions: IntegrityAbstention[] }) {
  const groups = new Map<string, { rule: string; reason: string; count: number }>();
  for (const a of abstentions) {
    const key = `${a.rule}|${a.reason}`;
    const g = groups.get(key) ?? { rule: a.rule, reason: a.reason, count: 0 };
    g.count++;
    groups.set(key, g);
  }
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p className="font-bold">{t("integrityNotCompared", { count: abstentions.length })}</p>
      <ul className="list-disc space-y-0.5 pl-5">
        {[...groups.values()].map((g) => (
          <li key={`${g.rule}|${g.reason}`}>
            {ruleName(t, g.rule)} — {reasonText(t, g.reason)}
            {g.count > 1 ? ` (${g.count})` : ""}
          </li>
        ))}
      </ul>
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

/** A rule named for a skip line: its meaning, or its id when the web does not know it yet. */
function ruleName(t: T, rule: string): string {
  const key = `integrityRule_${rule}`;
  return t.has(key) ? t(key) : rule;
}

/** Why a rule skipped; an unknown reason code from a newer server is shown as is. */
function reasonText(t: T, reason: string): string {
  const key = `integrityAbstain_${reason}`;
  return t.has(key) ? t(key) : reason;
}

function scopeText(t: T, scope: string): string {
  if (scope === "networth") return t("integrityScopeNetworth");
  return t("integrityScopePortfolio", { id: scope.replace(/^portfolio:/, "").slice(0, 8) });
}
