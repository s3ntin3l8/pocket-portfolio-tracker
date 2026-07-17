import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { and, eq, ne } from "drizzle-orm";
import { screenshotImports } from "@portfolio/db";
import { extractPdfText } from "../../../services/parsers/pdf-text.js";
import { detectDkbPdf, parseDkbPdf } from "../../../services/parsers/dkb-pdf.js";
import { detectTrPdf, parseTrPdf } from "../../../services/parsers/tr-pdf.js";
import { detectReportPdf } from "../../../services/parsers/report-pdf.js";
import { assignContentExternalIds, shortHash } from "../../../services/parsers/hash.js";
import { accountMismatchVerdict } from "../helpers.js";
import { storeReceipt } from "../../../storage/receipts.js";
import { getImportStrategy } from "../../../services/import-settings.js";
import {
  isAcceptedMime,
  existingImport,
  resolveReuse,
  forceFromQuery,
  batchIdFromQuery,
  matchAccountNumber,
  soleOwnedPortfolioId,
  annotateLikelyDuplicates,
} from "./helpers.js";

export async function handleScreenshotUpload(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const id = request.userId;
  if (!app.screenshotParser.isConfigured()) {
    request.log.warn({ provider: app.screenshotParser.name }, "screenshot parser not configured");
    return reply.code(503).send({ error: "screenshot_parser_not_configured" });
  }

  let part;
  try {
    part = await request.file();
  } catch {
    return reply.code(400).send({ error: "no_file" });
  }
  if (!part) return reply.code(400).send({ error: "no_file" });

  const mimeType = part.mimetype || "image/png";
  if (!isAcceptedMime(mimeType)) {
    await part.toBuffer().catch(() => {});
    return reply.code(415).send({ error: "unsupported_media_type" });
  }

  let buf: Buffer;
  try {
    buf = await part.toBuffer();
  } catch (err) {
    if ((err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
      return reply.code(413).send({ error: "file_too_large", limitMb: 25 });
    }
    throw err;
  }

  const rawHash = shortHash(buf.toString("base64"));

  let pdfText: string | null = null;
  let contentHash = rawHash;
  if (mimeType === "application/pdf") {
    try {
      const text = await extractPdfText(buf);
      const normalized = text.replace(/\s+/g, " ").trim();
      if (normalized) {
        pdfText = text;
        contentHash = shortHash(normalized);
      }
    } catch (err) {
      request.log.warn({ err }, "pdf text extraction for dedup failed; using raw-byte hash");
    }
  }

  if (pdfText) {
    const reportMatch = detectReportPdf(pdfText);
    if (reportMatch) {
      request.log.info(
        { category: reportMatch.category, taxYear: reportMatch.taxYear },
        "PDF recognized as an account-level report",
      );
      return {
        isReport: true,
        reportCategory: reportMatch.category,
        reportTaxYear: reportMatch.taxYear,
        reportTitle: reportMatch.title,
      };
    }
  }

  request.log.info({ mimeType, bytes: buf.length }, "screenshot import started");

  const existing = await resolveReuse(
    app,
    await existingImport(app, id, [contentHash, rawHash]),
    forceFromQuery(request.query),
  );
  if (existing) {
    const isDraft = existing.status === "draft";
    const storedParsed = isDraft
      ? ((existing.parsedJson ?? {}) as {
          drafts?: unknown[];
          contracts?: unknown[];
          errors?: unknown[];
          accountNumber?: string | null;
        })
      : null;
    const matchedPortfolioId = isDraft
      ? await matchAccountNumber(app, id, storedParsed?.accountNumber)
      : null;
    request.log.info(
      { importId: existing.id, status: existing.status },
      "screenshot import deduplicated",
    );
    reply.code(200);
    return {
      importId: existing.id,
      drafts:
        isDraft && storedParsed && Array.isArray(storedParsed.drafts) ? storedParsed.drafts : [],
      contracts:
        isDraft && storedParsed && Array.isArray(storedParsed.contracts)
          ? storedParsed.contracts
          : [],
      errors:
        isDraft && storedParsed && Array.isArray(storedParsed.errors) ? storedParsed.errors : [],
      alreadyExists: isDraft,
      alreadyConfirmed: !isDraft,
      matchedPortfolioId,
      suggestedPortfolioId: matchedPortfolioId ?? (await soleOwnedPortfolioId(app, id)),
    };
  }

  let parsed;
  const importStrategy = await getImportStrategy(app.db);
  let parserTag = app.screenshotParser.name;
  if (importStrategy === "parser_first" && mimeType === "application/pdf") {
    try {
      const text = pdfText ?? (await extractPdfText(buf));
      if (detectDkbPdf(text)) {
        const { drafts: dkbDrafts, accountNumber: dkbAccount } = parseDkbPdf(text);
        if (dkbDrafts.length > 0) {
          request.log.info({ drafts: dkbDrafts.length }, "DKB PDF parsed deterministically");
          parsed = { drafts: dkbDrafts, contracts: [], accountNumber: dkbAccount };
          parserTag = "dkb-pdf";
        }
      } else if (detectTrPdf(text)) {
        const { drafts: trDrafts, errors: trErrors } = parseTrPdf(text);
        if (trDrafts.length > 0) {
          request.log.info({ drafts: trDrafts.length }, "TR PDF parsed deterministically");
          parsed = { drafts: trDrafts, contracts: [], accountNumber: null };
          parserTag = "tr-pdf";
          if (trErrors.length > 0) {
            request.log.warn({ errors: trErrors }, "TR PDF parse had errors");
          }
        }
      }
    } catch (err) {
      request.log.warn({ err }, "DKB/TR PDF text parse failed; falling back to vision");
    }
  }
  try {
    parsed ??= await app.screenshotParser.parse({ data: buf, mimeType }, request.log);
  } catch (err) {
    const message = (err as Error)?.message ?? "";
    const m = /vision_error_(\d+)$/.exec(message);
    request.log.error({ err }, "screenshot parse failed");
    return reply.code(502).send({
      error: "screenshot_parse_failed",
      reason: "provider_error",
      provider: app.screenshotParser.name,
      providerStatus: m ? Number(m[1]) : null,
    });
  }

  const { drafts, contracts, accountNumber: detectedAccountNumber } = parsed;
  const scored = [...drafts.map((d) => d.confidence), ...contracts.map((c) => c.confidence)];
  const confidence =
    scored.length > 0 ? String(scored.reduce((s, c) => s + c, 0) / scored.length) : null;
  assignContentExternalIds(drafts, "screenshot");
  const result = {
    drafts,
    contracts,
    errors: [] as { line: number; message: string }[],
    accountNumber: detectedAccountNumber ?? null,
  };

  const matchedPortfolioId = await matchAccountNumber(app, id, detectedAccountNumber);
  const candidate = matchedPortfolioId ?? (await soleOwnedPortfolioId(app, id));
  await annotateLikelyDuplicates(app, result.drafts, candidate, parserTag);
  const accountMismatch = candidate
    ? await accountMismatchVerdict(app, id, detectedAccountNumber, candidate)
    : null;

  let imp = (
    await app.db
      .insert(screenshotImports)
      .values({
        userId: id,
        portfolioId: matchedPortfolioId ?? null,
        parser: parserTag,
        parsedJson: result,
        confidence,
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
    buf,
    mimeType,
    originalFilename: part.filename ?? null,
    source: parserTag,
  });

  request.log.info(
    {
      importId: imp.id,
      drafts: result.drafts.length,
      contracts: result.contracts.length,
      confidence,
      matchedPortfolioId,
    },
    "screenshot parse stored",
  );
  reply.code(201);
  return {
    importId: imp.id,
    drafts: result.drafts,
    contracts: result.contracts,
    errors: result.errors,
    matchedPortfolioId,
    suggestedPortfolioId: candidate,
    accountMismatch,
  };
}
