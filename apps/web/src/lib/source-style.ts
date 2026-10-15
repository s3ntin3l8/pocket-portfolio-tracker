import { FileSpreadsheet, FileText, PencilLine, ScanText } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { tint } from "./tint";

/**
 * Per-source-type icon + tint, transcribed from `Pocket Prototype.dc.html` (the `SRCTYPE`
 * map). A tinted rounded square keyed by import origin; unknown types fall back to neutral.
 * Shared by {@link TransactionSourcesSection} and {@link ImportHistory} so both surfaces use
 * the same palette instead of two copies drifting apart.
 */
export const SRC_STYLE: Record<string, { icon: LucideIcon; bg: string; fg: string }> = {
  csv: { icon: FileSpreadsheet, ...tint("teal") },
  pdf: { icon: FileText, ...tint("destructive") },
  screenshot: { icon: ScanText, ...tint("violet") },
  pytr: { icon: FileText, ...tint("teal") },
  ibkr: { icon: FileText, ...tint("teal") },
  manual: { icon: PencilLine, bg: "var(--border)", fg: "var(--text-mute)" },
};

export const DEFAULT_SRC = { icon: FileText, bg: "var(--border)", fg: "var(--text-mute)" };

/**
 * Maps a stored `ImportRecord.parser` tag to one of the 5 friendly source categories used
 * for {@link SRC_STYLE} and the `Transactions.sources.*` labels.
 *
 * Mirrors `parserToTxSource()` in `services/api/src/services/parsers/dedup.ts` — same tag
 * semantics (csv/dkb/tr-csv → csv, dkb-pdf/tr-pdf → pdf, ibkr, pytr, ai → manual, else → screenshot).
 * Duplicated here because that module lives in the API service package (Node runtime) and
 * isn't reachable from the browser bundle. Keep the two in sync if the tag set changes.
 */
export function parserToSourceType(parser: string): string {
  if (parser === "ai") return "manual"; // AI-assisted entry is typed-in data the user confirmed
  if (parser === "pytr") return "pytr";
  if (parser === "ibkr") return "ibkr";
  if (parser === "dkb-pdf" || parser === "tr-pdf") return "pdf";
  if (parser === "csv" || parser === "dkb" || parser === "tr-csv") return "csv";
  return "screenshot";
}
