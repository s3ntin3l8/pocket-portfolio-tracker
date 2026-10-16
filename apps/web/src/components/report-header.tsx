import { BackLink } from "@/components/back-button";
import { cn } from "@/lib/utils";

/**
 * Report-screen header. A back button sits to the LEFT of the title on mobile, with the title
 * over an optional muted subtitle, and an optional right-aligned action (e.g. Export). On
 * desktop the topbar owns both the title and back-link (via `PageHeaderSetter`), so they're
 * hidden here — the action stays visible. The report screens are reached from the
 * `/reports` hub, so back returns there by default.
 */
export function ReportHeader({
  title,
  subtitle,
  backHref = "/reports",
  action,
}: {
  title: string;
  subtitle?: React.ReactNode;
  backHref?: string;
  /** On narrow screens, the action occupies a second row below the title and subtitle. */
  action?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mb-6",
        action
          ? "grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 md:flex md:items-center"
          : "flex items-center gap-3",
      )}
    >
      <BackLink href={backHref} />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-heading font-semibold md:sr-only">{title}</h1>
        {subtitle && (
          <p className={cn("text-sm text-text-2", typeof subtitle === "string" && "truncate")}>
            {subtitle}
          </p>
        )}
      </div>
      {action && (
        <div className="col-start-2 row-start-2 justify-self-end md:ml-auto">{action}</div>
      )}
    </div>
  );
}
