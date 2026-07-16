import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function ErrorBanner({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive",
        className,
      )}
    >
      <AlertCircle className="size-4 shrink-0" />
      {children}
    </div>
  );
}
