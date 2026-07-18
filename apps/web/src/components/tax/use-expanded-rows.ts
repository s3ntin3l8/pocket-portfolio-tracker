import { useState } from "react";

/** Row-expansion state shared by both tables below — keyed by `symbol:when`, the same
 *  key `loadTaxYearDetail` groups disposals on. */
export function useExpandedRows() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return { expanded, toggle };
}
