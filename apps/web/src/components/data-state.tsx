import { useTranslations } from "next-intl";
import { Clock, LockKeyhole, ServerCrash, type LucideIcon } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { EmptyState } from "@/components/empty-state";
import { DataStateRetry } from "@/components/data-state-retry";
import { Button } from "@/components/ui/button";

export type DataStateStatus = "empty" | "unauthorized" | "rate_limited" | "unavailable";

/**
 * One place that turns a loader status into the right message instead of a single
 * "Can't reach the API" card: "empty" (the caller's own copy — nothing to show yet),
 * "unauthorized" (session expired), "rate_limited" (with a live countdown from
 * `retryAfter`) and "unavailable" (API unreachable). Every failure state carries an inline
 * Retry that re-runs the server loaders via `router.refresh()`. Never reports a transient
 * failure as "not found".
 *
 * Renders on the server or the client (the interactive bit is `DataStateRetry`), so a
 * server page can pass its `LucideIcon` straight through.
 */
export function DataState({
  status,
  retryAfter,
  icon,
  empty,
}: {
  status: DataStateStatus;
  /** Seconds to wait, for `rate_limited`. */
  retryAfter?: number | null;
  /** Icon for the empty state; failure states use their own. */
  icon: LucideIcon;
  /** Copy for `status="empty"`. */
  empty?: { title: string; description: string; action?: React.ReactNode };
}) {
  const t = useTranslations("DataState");
  const te = useTranslations("Empty");

  if (status === "empty") {
    return (
      <EmptyState
        icon={icon}
        title={empty?.title ?? ""}
        description={empty?.description ?? ""}
        action={empty?.action}
      />
    );
  }

  if (status === "unauthorized") {
    return (
      <EmptyState
        icon={LockKeyhole}
        title={t("unauthorizedTitle")}
        description={t("unauthorizedBody")}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/">{t("signIn")}</Link>
            </Button>
            <DataStateRetry />
          </div>
        }
      />
    );
  }

  if (status === "rate_limited") {
    return (
      <EmptyState
        icon={Clock}
        title={t("rateLimitedTitle")}
        description={
          retryAfter ? t("rateLimitedBody", { seconds: retryAfter }) : t("rateLimitedBodyNoTime")
        }
        action={<DataStateRetry retryAfter={retryAfter} />}
      />
    );
  }

  return (
    <EmptyState
      icon={ServerCrash}
      title={te("unavailableTitle")}
      description={te("unavailableBody")}
      action={<DataStateRetry />}
    />
  );
}
