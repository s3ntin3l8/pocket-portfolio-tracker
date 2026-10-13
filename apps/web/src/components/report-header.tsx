import { ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * Report-screen header (reference: Realized P&L / Income / Savings / Tax). A back chevron —
 * a 36px card-surface button — sits to the LEFT of the title on mobile, with the title
 * (700/24) over an optional muted subtitle, and an optional right-aligned action
 * (e.g. Export). On desktop the topbar owns both the title and back-link (via
 * `PageHeaderSetter`), so they're hidden here — the action stays visible. The report
 * screens are reached from the `/reports` hub, so back returns there by default.
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
  const tA = useTranslations("A11y");
  return (
    <div
      className={cn(
        "mb-6",
        action
          ? "grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 md:flex md:items-center"
          : "flex items-center gap-3",
      )}
    >
      <Link
        href={backHref}
        aria-label={tA("back")}
        // Visual size stays the reference's 36px card button; `before:` pads the tap
        // target out to ~44px (the touch-target minimum) without affecting layout.
        className="relative flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-card text-foreground shadow-[0_1px_2px_rgba(15,27,20,.08)] transition-transform before:absolute before:-inset-1 active:scale-95 md:hidden"
      >
        <ChevronLeft className="size-[19px]" strokeWidth={2.2} />
      </Link>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-2xl font-bold md:sr-only">{title}</h1>
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
