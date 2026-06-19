import { importSettings } from "@portfolio/db";
import { importStrategySchema, type ImportStrategy } from "@portfolio/schema";
import type { DB } from "../db/client.js";

// The global import strategy is a singleton row (id=1). A missing row means the
// "parser_first" default; an out-of-range stored value is coerced back to it too.
export const IMPORT_SETTINGS_ID = 1;
export const DEFAULT_IMPORT_STRATEGY: ImportStrategy = "parser_first";

// Read the configured strategy for the unstructured import path (screenshots + PDFs).
// Uploads are infrequent, so this is read per-upload rather than cached.
export async function getImportStrategy(db: DB): Promise<ImportStrategy> {
  const [row] = await db
    .select({ strategy: importSettings.strategy })
    .from(importSettings)
    .limit(1);
  return importStrategySchema.catch(DEFAULT_IMPORT_STRATEGY).parse(row?.strategy);
}
