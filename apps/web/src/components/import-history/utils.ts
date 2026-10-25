import type { ImportRecord } from "@portfolio/api-client";
import { parserToSourceType, SRC_STYLE, DEFAULT_SRC } from "@/lib/source-style";

export const isDeadSyncAnchor = (i: ImportRecord) =>
  (i.parser === "ibkr" || i.parser === "pytr") && i.status === "confirmed";

export function statusLabelKey(imp: ImportRecord): string {
  if ((imp.parser === "ibkr" || imp.parser === "pytr") && imp.status === "draft") {
    return "status.syncNeedsAttention";
  }
  return `status.${imp.status}`;
}

/**
 * The `Transactions`-namespace translator. `has` is part of next-intl's translator, but the
 * prop type has to say so explicitly — a dynamic key that isn't in the catalogue would
 * otherwise throw instead of falling back to a real label (R4-F7).
 */
export type SourceTranslator = ((key: string) => string) & { has: (key: string) => boolean };

export function sourceMeta(imp: ImportRecord, ts: SourceTranslator) {
  const sourceType = parserToSourceType(imp.parser);
  const style = SRC_STYLE[sourceType] ?? DEFAULT_SRC;
  const sourceLabel = ts.has(`sources.${sourceType}`)
    ? ts(`sources.${sourceType}`)
    : ts("sourcesOther");
  return { style, sourceLabel, label: imp.originalFilename ?? sourceLabel };
}
