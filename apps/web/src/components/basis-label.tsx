/**
 * The muted caption that names what a figure is measured against / counts ("vs cost of
 * holdings", "All income types, net of fees and tax"). One component so gain figures and
 * income stats spell out their basis identically (audit G2).
 */
export function BasisLabel({ children }: { children: React.ReactNode }) {
  return <p className="mt-0.5 text-[11px] font-medium text-text-2">{children}</p>;
}
