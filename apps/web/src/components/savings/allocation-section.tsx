"use client";

import type { DriftRow, SparplanContributionSplit } from "@portfolio/api-client";
import type { useTranslations } from "next-intl";
import { formatFixed, formatMoney, formatPercentPoints } from "@/lib/utils";
import { tint } from "@/lib/tint";

export const SEG_COLORS = [
  "var(--violet)",
  "var(--chart-3)",
  "var(--gold-fg)",
  "var(--primary)",
  "var(--info)",
  "var(--orange)",
];

export function AllocationSection({
  drift,
  contributionSplit,
  nameByKey,
  colorByKey,
  monthlyTotalLabel,
  currency,
  locale,
  t,
}: {
  drift: DriftRow[];
  contributionSplit?: SparplanContributionSplit[];
  nameByKey: Map<string, string>;
  colorByKey: Map<string, string>;
  monthlyTotalLabel: string;
  currency: string;
  locale: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const splitByKey = new Map((contributionSplit ?? []).map((s) => [s.key, s]));
  const nameOf = (key: string) => nameByKey.get(key) ?? key;

  const worst = drift
    .filter((d) => d.status !== "on_target")
    .sort((a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct))[0];

  let strong: string;
  let rest: string;
  if (!worst) {
    strong = t("driftOnTargetStrong");
    rest = t("driftOnTargetRest");
  } else {
    const name = nameOf(worst.key);
    const pct = formatFixed(Math.abs(worst.driftPct), locale, 1);
    const target = formatPercentPoints(worst.targetPct, locale, 0);
    if (worst.status === "under") {
      const s = splitByKey.get(worst.key);
      strong = t("driftUnderStrong", { name, pct });
      rest = t("driftUnderRest", {
        amount: s ? formatMoney(Number(s.amount), currency, locale) : "—",
        target,
      });
    } else {
      strong = t("driftOverStrong", { name, pct });
      rest = t("driftOverRest", { target });
    }
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
      <p className="mb-[9px] text-micro font-semibold uppercase tracking-wide text-text-2">
        {t("allocTitle")}
      </p>

      <div className="mb-2.5 flex h-[9px] gap-0.5 overflow-hidden rounded-md">
        {drift.map((d) => (
          <span
            key={d.key}
            className="h-full rounded-xs"
            style={{ width: `${d.actualPct.toFixed(1)}%`, backgroundColor: colorByKey.get(d.key) }}
          />
        ))}
      </div>

      <div className="mb-3 flex flex-col gap-1.5">
        {drift.map((d) => (
          <div key={d.key} className="flex items-center gap-2 text-micro font-semibold">
            <span
              className="size-2 shrink-0 rounded-xs"
              style={{ backgroundColor: colorByKey.get(d.key) }}
            />
            <span className="min-w-0 flex-1 truncate text-text-2">{nameOf(d.key)}</span>
            <span className="tabular text-text-2">
              {t("allocTarget", { pct: formatPercentPoints(d.targetPct, locale, 0) })}
            </span>
            <span className="tabular w-[62px] text-right">
              {t("allocNow", { pct: formatPercentPoints(d.actualPct, locale, 0) })}
            </span>
          </div>
        ))}
      </div>

      <div
        className="flex items-start gap-2.5 rounded-xl px-[13px] py-[11px]"
        style={{ backgroundColor: tint("gold").bg }}
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--gold-fg)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mt-px shrink-0"
          aria-hidden
        >
          <path d="M12 2v20M2 12h20" />
        </svg>
        <p className="text-xs font-medium leading-[1.45]">
          <b style={{ color: "var(--warn-strong)" }}>{strong}</b>
          <span style={{ color: "var(--warn-soft)" }}>{rest}</span>
        </p>
      </div>

      {contributionSplit && contributionSplit.length > 0 && (
        <div className="mt-3.5">
          <p className="mb-2 text-micro font-semibold uppercase tracking-wide text-text-2">
            {t("recommendedTopUp", { total: monthlyTotalLabel })}
          </p>
          <div className="flex flex-col gap-1.5">
            {contributionSplit.map((s) => (
              <div key={s.key} className="flex items-center gap-2 text-xs font-semibold">
                <span className="min-w-0 flex-1 truncate text-text-2">{nameOf(s.key)}</span>
                <span className="tabular">{formatMoney(Number(s.amount), currency, locale)}</span>
                <span className="tabular w-[42px] text-right text-text-2">
                  {formatPercentPoints(s.sharePct, locale, 0)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
