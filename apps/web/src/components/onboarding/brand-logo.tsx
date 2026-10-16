import { cn } from "@/lib/utils";
import { Icon, ICONS } from "./icon";

/** The Pocket mark + wordmark used on the brand panel, the mobile intro and the mobile
 *  header. Text colour is inherited, so callers set it (white on the dark brand surfaces,
 *  foreground on the light mobile header). */
export function BrandLogo({ size = "lg", className }: { size?: "sm" | "lg"; className?: string }) {
  const large = size === "lg";
  return (
    <div className={cn("flex items-center", large ? "gap-3" : "gap-2", className)}>
      <span
        className={cn(
          "flex items-center justify-center bg-primary",
          large ? "size-10 rounded-lg" : "size-8 rounded-sm",
        )}
      >
        <Icon d={ICONS.wallet} size={large ? 22 : 17} className="text-white" />
      </span>
      <span className={cn("font-bold", large ? "text-xl" : "text-base")}>Pocket</span>
    </div>
  );
}
