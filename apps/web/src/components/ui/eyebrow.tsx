import { cn } from "@/lib/utils";

export function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "px-0.5 text-micro font-semibold uppercase tracking-label text-muted-foreground",
        className,
      )}
    >
      {children}
    </p>
  );
}
