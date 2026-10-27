"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { apiErrorCode, type ApiClient } from "@portfolio/api-client";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Spinner } from "@/components/ui/spinner";

/** The slice of the API client this panel needs (injectable for tests). */
export type HistoryRecheckClient = Pick<ApiClient, "triggerMyBackfill">;

type State =
  | { status: "idle" }
  | { status: "running" }
  | { status: "queued" }
  | { status: "error"; reason: "already_queued" | "rate_limited" | "unavailable" | "other" };

/**
 * Settings › Data & connections › Price history: asks the API to re-run the history backfill for
 * the caller's own portfolios. Fire-and-forget: "queued" means the job was accepted, not that it
 * has finished (there is no per-user job status).
 */
export function HistoryRecheckPanel({ client }: { client: HistoryRecheckClient }) {
  const t = useTranslations("Settings");
  const [state, setState] = useState<State>({ status: "idle" });
  const [retryDeadFeeds, setRetryDeadFeeds] = useState(false);

  async function run() {
    if (state.status === "running") return;
    setState({ status: "running" });
    try {
      await client.triggerMyBackfill({ retryDeadFeeds });
      setState({ status: "queued" });
    } catch (err) {
      const code = apiErrorCode(err);
      setState({
        status: "error",
        reason:
          code === "already_in_flight"
            ? "already_queued"
            : code === "backfill_rate_limited"
              ? "rate_limited"
              : code === "scheduler_unavailable"
                ? "unavailable"
                : "other",
      });
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("historyRecheckHint")}</p>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4"
          checked={retryDeadFeeds}
          onChange={(e) => setRetryDeadFeeds(e.target.checked)}
        />
        {t("historyRecheckRetryDead")}
      </label>

      <Button onClick={run} disabled={state.status === "running"}>
        {state.status === "running" ? (
          <>
            <Spinner className="mr-2 size-4" />
            {t("historyRecheckRunning")}
          </>
        ) : (
          t("historyRecheckRun")
        )}
      </Button>

      <div aria-live="polite">
        {state.status === "queued" && (
          <p className="text-sm text-muted-foreground">{t("historyRecheckQueued")}</p>
        )}
        {state.status === "error" && (
          <ErrorBanner>
            {state.reason === "already_queued"
              ? t("historyRecheckAlreadyQueued")
              : state.reason === "rate_limited"
                ? t("historyRecheckRateLimited")
                : state.reason === "unavailable"
                  ? t("historyRecheckUnavailable")
                  : t("historyRecheckError")}
          </ErrorBanner>
        )}
      </div>
    </div>
  );
}
