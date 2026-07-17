import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { documentUploadFieldsSchema } from "@portfolio/schema";
import { ownedPortfolio } from "../helpers.js";
import { shortHash } from "../../services/parsers/hash.js";
import { storeInboxDocument } from "../../storage/inbox.js";
import { fieldValue } from "./helpers.js";

export async function handleUploadDocument(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const id = request.userId;

  let part;
  try {
    part = await request.file();
  } catch {
    return reply.code(400).send({ error: "no_file" });
  }
  if (!part) return reply.code(400).send({ error: "no_file" });

  const mimeType = part.mimetype || "application/pdf";
  if (mimeType !== "application/pdf") {
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

  const parsedFields = documentUploadFieldsSchema.safeParse({
    category: fieldValue(part.fields.category),
    taxYear: fieldValue(part.fields.taxYear),
    portfolioId: fieldValue(part.fields.portfolioId),
  });
  if (!parsedFields.success) {
    return reply.code(400).send({ error: "invalid_fields" });
  }
  const { category, taxYear, portfolioId: requestedPortfolioId } = parsedFields.data;

  const portfolio = await ownedPortfolio(app, id, requestedPortfolioId);
  if (!portfolio) return reply.code(404).send({ error: "portfolio_not_found" });
  const portfolioId = portfolio.id;

  const contentHash = shortHash(buf.toString("base64"));
  const result = await storeInboxDocument(app, {
    userId: id,
    portfolioId,
    category,
    taxYear: taxYear ?? null,
    buf,
    mimeType,
    originalFilename: part.filename,
    source: "upload",
    sourceEventId: `upload:${contentHash}`,
  });

  if (!result.ok) {
    request.log.error({ err: result.error }, "document upload failed");
    return reply.code(500).send({ error: "upload_failed" });
  }

  request.log.info(
    { documentId: result.documentId, category, duplicate: Boolean(result.duplicate) },
    "inbox document uploaded",
  );
  reply.code(result.duplicate ? 200 : 201);
  return {
    id: result.documentId,
    duplicate: Boolean(result.duplicate),
    category,
    taxYear: taxYear ?? null,
  };
}
