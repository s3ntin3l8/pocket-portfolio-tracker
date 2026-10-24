/**
 * Shared import-policy rules.
 *
 * These three decisions used to live in three different places — the upload-time
 * annotator, the confirm endpoint and the broker-sync materializer — and each had its own
 * slightly different definition. The result was that the review screen and the confirm
 * gate classified the very same pair of records differently, and the stricter of the two
 * won at the wrong moment (a row the user was shown as a duplicate was dropped from the
 * import; a row the user was shown as an enrichment was written twice).
 *
 * One module, one definition, imported by every caller.
 */

/**
 * The transaction statuses that participate in every derivation.
 *
 * A row in any other status is invisible to holdings, cash, contributions and tax
 * (`services/tx-core.ts` drops `draft` and `archived` rows before handing them to
 * `packages/core`). The dedup candidate set must use the *same* predicate: a row that no
 * derivation can see must not be able to block an import, absorb an import, or resolve a
 * broker event.
 */
export const CONFIRMED_TX_STATUSES = ["normal", "cash_neutral"] as const;

export type ConfirmedTxStatus = (typeof CONFIRMED_TX_STATUSES)[number];

/** Is this transaction status one a derivation actually counts? */
export function isConfirmedTxStatus(status: string | null | undefined): boolean {
  return status != null && (CONFIRMED_TX_STATUSES as readonly string[]).includes(status);
}

/**
 * Import kinds that never carry a document of their own.
 *
 * - `ai` — AI-assisted entry is typed-in data the user confirms; there is no file behind
 *   it, so it can never "enrich" a committed row from another source.
 * - `ibkr` — the Flex XML pull has no stored statement document.
 *
 * Every other kind (screenshot, PDF, CSV, pytr) uploads or syncs a file that is retained
 * as the import's document, which is exactly what makes it enrichment-capable.
 */
const DOCUMENTLESS_PARSERS = new Set(["ai", "ibkr"]);

/**
 * Will this import kind carry a document?
 *
 * This is the *prediction* used at upload time (before the document row exists). The
 * confirm gate additionally checks the fact (`getStagedDocumentId`) and ORs the two, so
 * the prediction can only ever make a kind *more* enrichment-capable, never less — an
 * unexpected document is still honoured, while the two call sites always agree on the
 * kinds we know about.
 */
export function parserCarriesDocument(parser: string): boolean {
  return !DOCUMENTLESS_PARSERS.has(parser);
}

/**
 * Can this incoming import *enrich* a committed row from another source?
 *
 * Enrichment means the incoming import carries something the committed row lacks: a
 * document (the settlement PDF, the statement CSV) or explicit tax components. Such a
 * match is auto-applied — the document is linked and the tax/fees are folded in — instead
 * of blocking the import with a 409.
 *
 * A same-source match, or a match with nothing new to contribute, is a **duplicate**: it
 * blocks and the user decides.
 */
export function isEnrichmentCapable(args: {
  hasStagedDocument: boolean;
  hasTaxComponents: boolean;
}): boolean {
  return args.hasStagedDocument || args.hasTaxComponents;
}
