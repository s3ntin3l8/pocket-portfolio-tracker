/**
 * The muted caption under a figure that names what it is measured against / counts
 * ("vs cost of holdings", "All income types, net of fees and tax rows"). One component so
 * the stacked gain figures and the income stats spell out their basis identically
 * (audit G2); `GainFigure`'s inline layout keeps its own span, since it shares the value's line.
 */
export function BasisLabel({ children }: { children: React.ReactNode }) {
  return <p className="mt-0.5 text-micro font-medium text-text-2">{children}</p>;
}
