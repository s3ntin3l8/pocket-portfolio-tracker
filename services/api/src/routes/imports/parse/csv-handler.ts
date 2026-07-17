import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { and, eq, ne } from "drizzle-orm";
import { screenshotImports } from "@portfolio/db";
import { detectCsvFormat } from "../../../services/parsers/detect.js";
import { assignContentExternalIds, shortHash } from "../../../services/parsers/hash.js";
import { accountMismatchVerdict } from "../helpers.js";
import { storeReceipt } from "../../../storage/receipts.js";
import {
  csvBodySchema,
  CSV_PARSERS,
  PARSER_TAG,
  existingImport,
  resolveReuse,
  forceFromQuery,
  batchIdFromQuery,
  matchAccountNumber,
  soleOwnedPortfolioId,
  annotateLikelyDuplicates,
} from "./helpers.js";

export async function handleCsvUpload(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const id = request.userId;
  const { content, filename, format } = csvBodySchema.parse(request.body);
  const force = forceFromQuery(request.query);
  const contentHash = shortHash(content);

  request.log.info({ requestedFormat: format, bytes: content.length }, "csv import started");

  const existing = await resolveReuse(app, await existingImport(app, id, contentHash), force);
  if (existing) {
    const isDraft = existing.status === "draft";
    const parsed = isDraft
      ? ((existing.parsedJson ?? {}) as {
          drafts?: unknown[];
          errors?: unknown[];
          accountNumber?: string | null;
        })
      : null;
    const matchedPortfolioId = isDraft
      ? await matchAccountNumber(app, id, parsed?.accountNumber)
      : null;
    request.log.info({ importId: existing.id, status: existing.status }, "csv import deduplicated");
    reply.code(200);
    return {
      importId: existing.id,
      drafts: isDraft && parsed && Array.isArray(parsed.drafts) ? parsed.drafts : [],
      contracts: [] as unknown[],
      errors: isDraft && parsed && Array.isArray(parsed.errors) ? parsed.errors : [],
      alreadyExists: isDraft,
      alreadyConfirmed: !isDraft,
      matchedPortfolioId,
      suggestedPortfolioId: matchedPortfolioId ?? (await soleOwnedPortfolioId(app, id)),
    };
  }

  const resolved = format === "auto" ? detectCsvFormat(content) : format;
  request.log.debug({ resolved, parser: PARSER_TAG[resolved] ?? "csv" }, "csv format detected");
  const result = CSV_PARSERS[resolved](content);
  assignContentExternalIds(result.drafts, "csv");
  for (const e of result.errors) {
    request.log.debug({ line: e.line, message: e.message }, "csv row rejected");
  }

  const detected = result.accountNumber ?? null;
  const matchedPortfolioId = await matchAccountNumber(app, id, detected);
  const candidate = matchedPortfolioId ?? (await soleOwnedPortfolioId(app, id));
  await annotateLikelyDuplicates(app, result.drafts, candidate, PARSER_TAG[resolved] ?? "csv");
  const accountMismatch = candidate
    ? await accountMismatchVerdict(app, id, detected, candidate)
    : null;

  let imp = (
    await app.db
      .insert(screenshotImports)
      .values({
        userId: id,
        portfolioId: matchedPortfolioId ?? null,
        parser: PARSER_TAG[resolved] ?? "csv",
        parsedJson: result,
        contentHash,
        batchId: batchIdFromQuery(request.query),
        status: "draft",
      })
      .onConflictDoNothing()
      .returning()
  )[0];

  if (!imp) {
    const [existing] = await app.db
      .select()
      .from(screenshotImports)
      .where(
        and(
          eq(screenshotImports.userId, id),
          eq(screenshotImports.contentHash, contentHash),
          ne(screenshotImports.status, "discarded"),
        ),
      )
      .limit(1);
    if (!existing) throw app.httpErrors.internalServerError("import race recovery failed");
    imp = existing;
  }

  await storeReceipt(app, {
    userId: id,
    importId: imp.id,
    buf: Buffer.from(content, "utf8"),
    mimeType: "text/csv",
    originalFilename: filename ?? null,
    source: PARSER_TAG[resolved] ?? "csv",
  });

  request.log.info(
    {
      importId: imp.id,
      drafts: result.drafts.length,
      errors: result.errors.length,
      matchedPortfolioId,
    },
    "csv parse complete",
  );
  reply.code(201);
  return {
    importId: imp.id,
    drafts: result.drafts,
    contracts: [] as unknown[],
    errors: result.errors,
    matchedPortfolioId,
    suggestedPortfolioId: candidate,
    accountMismatch,
  };
}
