import { useTranslations } from "next-intl";
import { Clock, LockKeyhole, ServerCrash, type LucideIcon } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { EmptyState } from "@/components/empty-state";
import { DataStateRetry } from "@/components/data-state-retry";
import { Button } from "@/components/ui/button";

export type DataStateStatus = "empty" | "unauthorized" | "rate_limited" | "unavailable";

type EmptyCopy = { title: string; description: string; action?: React.ReactNode };

export type DataStateProps = { retryAfter?: number | null } & (
  | {
      status: "empty";
      /** Icon for the empty state; failure states use their own. */
      icon: LucideIcon;
      /** Copy for `status="empty"`. */
      empty: EmptyCopy;
    }
  | {
      status: Exclude<DataStateStatus, "empty">;
      /** Unused by failure states (they use their own icon); accepted so a caller whose
       * status may be `"empty"` or a failure can pass one set of props. */
      icon?: LucideIcon;
      empty?: EmptyCopy;
    }
);

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
export function DataState(props: DataStateProps) {
  const { status, retryAfter } = props;
  const t = useTranslations("DataState");

  if (props.status === "empty") {
    const { icon, empty } = props;
    return (
      <EmptyState
        icon={icon}
        title={empty.title}
        description={empty.description}
        action={empty.action}
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
      title={t("unavailableTitle")}
      description={t("unavailableBody")}
      action={<DataStateRetry />}
    />
  );
}
