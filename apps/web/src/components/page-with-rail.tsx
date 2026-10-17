import { cn } from "@/lib/utils";

/**
 * The shared main-column + right-rail layout. Children are the main column followed by a
 * `PageRail`. The page's `@container` (set on `<main>` in the app shell) decides when the rail
 * moves beside the content (`@xl`); below that it stacks under it.
 *
 * Mobile order rule: main content first, rail after. The one exception is a page whose rail
 * holds the overview a reader wants before the detail (Insights): it passes
 * `railFirstOnMobile` to `PageRail`.
 */
export function PageWithRail({
  size = "default",
  className,
  ...props
}: React.ComponentProps<"div"> & {
  /** `narrow` is the 300px rail with the roomier gap used on the instrument page. */
  size?: "default" | "narrow";
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 @xl:items-start",
        size === "narrow"
          ? "gap-6 @xl:grid-cols-[minmax(0,1fr)_300px]"
          : "gap-5 @xl:grid-cols-[minmax(0,1fr)_320px]",
        className,
      )}
      {...props}
    />
  );
}

/** The rail: sticky under the topbar beside the content, scrolling on its own if it is taller
 *  than the viewport. Sits after the main column in the DOM so mobile gets main first. */
export function PageRail({
  railFirstOnMobile = false,
  className,
  ...props
}: React.ComponentProps<"div"> & { railFirstOnMobile?: boolean }) {
  return (
    <div
      className={cn(
        "min-w-0 @xl:sticky @xl:top-[calc(var(--topbar-h)+0.5rem)] @xl:order-last @xl:max-h-[calc(100vh-var(--topbar-h)-1.5rem)] @xl:overflow-y-auto",
        railFirstOnMobile && "order-first @xl:order-last",
        className,
      )}
      {...props}
    />
  );
}
