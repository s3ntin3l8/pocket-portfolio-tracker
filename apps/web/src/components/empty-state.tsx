import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A centered placeholder for empty, unavailable, or not-yet-available content. The default is
 * a dashed slot that fills a whole page region; `compact` is the quiet inline form for a
 * filtered list or table with no matches (no frame, tight padding, `description` optional).
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "px-6 py-8" : "rounded-lg border border-dashed border-border px-6 py-16",
      )}
    >
      <div
        className={cn(
          "rounded-md bg-muted text-muted-foreground",
          compact ? "mb-2 p-2" : "mb-4 p-3",
        )}
      >
        <Icon className={compact ? "size-5" : "size-6"} />
      </div>
      <h3 className="text-body font-semibold">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-body-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className={compact ? "mt-3" : "mt-5"}>{action}</div>}
    </div>
  );
}
