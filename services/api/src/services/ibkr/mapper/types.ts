import type { ParsedTransaction } from "@portfolio/schema";
import type { FlexStatement } from "../flex-parse.js";

export interface MapFlexResult {
  drafts: ParsedTransaction[];
  errors: Array<{ line?: number; message: string; raw?: unknown }>;
}

export type { FlexStatement };
