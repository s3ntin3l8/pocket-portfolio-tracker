import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, inArray, ne } from "drizzle-orm";
import { loans, portfolios, screenshotImports, transactions } from "@portfolio/db";
import type { ParsedTransaction } from "@portfolio/schema";
import { parseCsv } from "../../../services/parsers/csv.js";
import { parseDkb } from "../../../services/parsers/dkb.js";
import { parseIbkr } from "../../../services/parsers/ibkr.js";
import { parseCoinbase } from "../../../services/parsers/coinbase.js";
import { parseTrCsv } from "../../../services/parsers/tr-csv.js";
import { parseFlexXml } from "../../../services/ibkr/flex-parse.js";
import { mapFlexToDrafts } from "../../../services/ibkr/mapper.js";
import type { CsvParseResult } from "../../../services/parsers/csv.js";
import { findCommittedDuplicates } from "../../../services/parsers/likely-duplicates.js";
import { classifyMatch, parserToTxSource } from "../../../services/parsers/dedup.js";
import { normalizeAccountNumber, portfolioMatchesAccount } from "../helpers.js";

export const csvBodySchema = z.object({
  content: z.string().min(1),
  filename: z.string().optional(),
  format: z
    .enum(["auto", "generic", "dkb", "ibkr", "ibkr-xml", "coinbase", "tr-csv"])
    .default("auto"),
});

function parseIbkrFlex(content: string): CsvParseResult {
  try {
    const statements = parseFlexXml(content);
    if (statements.length === 0) return { drafts: [], errors: [] };
    const { drafts, errors } = mapFlexToDrafts(statements[0]!);
    const accountNumber = statements[0]?.accountId || undefined;
    return {
      drafts,
      errors: errors.map((e) => ({ line: e.line ?? 0, message: e.message })),
      accountNumber,
    };
  } catch (err) {
    return {
      drafts: [],
      errors: [{ line: 0, message: err instanceof Error ? err.message : "XML parse error" }],
    };
  }
}

export const CSV_PARSERS: Record<string, (content: string) => CsvParseResult> = {
  dkb: parseDkb,
  ibkr: parseIbkr,
  "ibkr-xml": parseIbkrFlex,
  coinbase: parseCoinbase,
  "tr-csv": parseTrCsv,
  generic: parseCsv,
};

export const PARSER_TAG: Record<string, "dkb" | "csv" | "tr-csv" | "ibkr"> = {
  dkb: "dkb",
  "tr-csv": "tr-csv",
  "ibkr-xml": "ibkr",
};

export function isAcceptedMime(mimeType: string): boolean {
  return mimeType.startsWith("image/") || mimeType === "application/pdf";
}

export async function existingImport(
  app: FastifyInstance,
  userId: string,
  contentHash: string | string[],
) {
  const hashes = Array.isArray(contentHash) ? contentHash : [contentHash];
  const [row] = await app.db
    .select()
    .from(screenshotImports)
    .where(
      and(
        eq(screenshotImports.userId, userId),
        inArray(screenshotImports.contentHash, hashes),
        ne(screenshotImports.status, "discarded"),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function importHasLiveRecords(
  app: FastifyInstance,
  importId: string,
): Promise<boolean> {
  const [tx] = await app.db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.importId, importId))
    .limit(1);
  if (tx) return true;
  const [loan] = await app.db
    .select({ id: loans.id })
    .from(loans)
    .where(eq(loans.importId, importId))
    .limit(1);
  return Boolean(loan);
}

export async function resolveReuse(
  app: FastifyInstance,
  existing: Awaited<ReturnType<typeof existingImport>> | null,
  force: boolean,
): Promise<Awaited<ReturnType<typeof existingImport>> | null> {
  if (!existing) return null;
  const supersede =
    force || (existing.status === "confirmed" && !(await importHasLiveRecords(app, existing.id)));
  if (!supersede) return existing;
  await app.db
    .update(screenshotImports)
    .set({ status: "discarded" })
    .where(
      existing.contentHash
        ? and(
            eq(screenshotImports.userId, existing.userId),
            eq(screenshotImports.contentHash, existing.contentHash),
            ne(screenshotImports.status, "discarded"),
          )
        : eq(screenshotImports.id, existing.id),
    );
  return null;
}

export function forceFromQuery(query: unknown): boolean {
  const f = (query as { force?: unknown } | null)?.force;
  return f === true || f === "true" || f === "1";
}

export function batchIdFromQuery(query: unknown): string | null {
  const b = (query as { batchId?: unknown } | null)?.batchId;
  return typeof b === "string" && z.string().uuid().safeParse(b).success ? b : null;
}

export async function matchAccountNumber(
  app: FastifyInstance,
  userId: string,
  detected: string | null | undefined,
): Promise<string | null> {
  if (!normalizeAccountNumber(detected)) return null;
  const rows = await app.db
    .select({ id: portfolios.id, accountNumber: portfolios.accountNumber, iban: portfolios.iban })
    .from(portfolios)
    .where(eq(portfolios.userId, userId));
  const matches = rows.filter((p) => portfolioMatchesAccount(p, detected));
  return matches.length === 1 ? (matches[0]?.id ?? null) : null;
}

export async function soleOwnedPortfolioId(
  app: FastifyInstance,
  userId: string,
): Promise<string | null> {
  const rows = await app.db
    .select({ id: portfolios.id })
    .from(portfolios)
    .where(eq(portfolios.userId, userId))
    .limit(2);
  return rows.length === 1 ? rows[0].id : null;
}

export async function annotateLikelyDuplicates(
  app: FastifyInstance,
  drafts: ParsedTransaction[],
  portfolioId: string | null,
  importParser: string,
): Promise<void> {
  if (!portfolioId || drafts.length === 0) return;

  const incomingTxSource = parserToTxSource(importParser);
  const importIsFileUpload = incomingTxSource === "screenshot" || incomingTxSource === "pdf";

  for (const { draftIndex, matched } of await findCommittedDuplicates(
    app.db,
    portfolioId,
    drafts,
  )) {
    const draft = drafts[draftIndex];
    const hasTaxComponents = draft.taxComponents && Object.keys(draft.taxComponents).length > 0;
    const draftHasEnrichment = importIsFileUpload || !!hasTaxComponents;
    const kind = classifyMatch(importParser, matched.source ?? "csv", draftHasEnrichment);
    (drafts[draftIndex] as Record<string, unknown>).likelyDuplicate = {
      kind,
      source: matched.source,
      executedAt: matched.executedAt,
      matchedTransactionId: matched.id,
    };
  }
}
