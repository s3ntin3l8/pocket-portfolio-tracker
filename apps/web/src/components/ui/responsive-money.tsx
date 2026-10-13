/**
 * A money string that never truncates (audit G5): the compact form (`€1.2M`) below the
 * `sm` breakpoint, the full form from `sm` up — switched in CSS so it works in server
 * components with no hydration flash. `whitespace-nowrap` keeps a value on one line; the
 * surrounding label is what's allowed to wrap. With no `compact`, only the full form renders.
 * The visual spans are `aria-hidden`; an `sr-only` full-precision copy is what assistive tech reads.
 */
export function ResponsiveMoney({ full, compact }: { full: string; compact?: string }) {
  if (!compact || compact === full) {
    return <span className="whitespace-nowrap">{full}</span>;
  }
  return (
    <span className="whitespace-nowrap">
      <span className="sm:hidden" data-money="compact" aria-hidden="true">
        {compact}
      </span>
      <span className="hidden sm:inline" data-money="full" aria-hidden="true">
        {full}
      </span>
      <span className="sr-only">{full}</span>
    </span>
  );
}
