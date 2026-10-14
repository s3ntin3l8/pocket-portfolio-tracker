import { DataState } from "@/components/data-state";
import { FxMissingBanner } from "@/components/fx-missing-banner";
import { collectFxMissing } from "@/lib/fx-missing";
import { retryAfterOf } from "@/lib/data-status";
import {
  incomeReport,
  tradesReport,
  contributionsReport,
  goldReport,
  taxReport,
} from "@/components/reports/reports-data";

/**
 * The Reports page's cross-card notices: the first failed loader (so a failure never
 * masquerades as "no data" nor leaves a silently partial page) and the FX-missing banner
 * (audit B2: currencies with no rate are left out of the card totals, never converted 1:1).
 *
 * Streamed behind its own `<Suspense>` — it needs every card's payload, but the cards no
 * longer wait for each other or for this. The loaders are request-cached, so awaiting them
 * here shares the cards' in-flight calls rather than issuing new ones. The FX list is read
 * from the response BODIES (`fxMissingCurrencies`), exactly as before; nothing depends on
 * the request-scoped header, so streaming does not change what it reports.
 */
export async function ReportsStatus() {
  const [income, trades, contributions, taxResult, gold] = await Promise.all([
    incomeReport(),
    tradesReport(),
    contributionsReport(),
    taxReport(),
    goldReport(),
  ]);

  const failure = [income, trades, contributions, taxResult].find(
    (r) => r.status === "unauthorized" || r.status === "rate_limited" || r.status === "unavailable",
  );

  // Currencies with no FX rate in any of the report sources.
  const fxMissing = collectFxMissing(
    income.status === "ok" ? income.data : null,
    trades.status === "ok" ? trades.data : null,
    contributions.status === "ok" ? contributions.data : null,
    gold.status === "ok" ? gold.data : null,
  );

  return (
    <>
      <FxMissingBanner currencies={fxMissing} />
      {failure && (
        <DataState
          status={failure.status as "unauthorized" | "rate_limited" | "unavailable"}
          retryAfter={retryAfterOf(failure)}
        />
      )}
    </>
  );
}
