import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { and, eq } from "drizzle-orm";
import { documents, transactions, transactionSources } from "@portfolio/db";
import { getDocumentForTransaction } from "../../storage/receipts.js";
import { gatherDocumentNaming, buildDocumentName } from "../../storage/naming.js";

export async function handleTxDocumentUrl(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const id = request.userId;
  const { portfolioId, txId } = request.params as { portfolioId: string; txId: string };

  const [tx] = await app.db
    .select({ id: transactions.id, importId: transactions.importId })
    .from(transactions)
    .where(and(eq(transactions.id, txId), eq(transactions.portfolioId, portfolioId)))
    .limit(1);
  if (!tx) return reply.code(404).send({ error: "transaction_not_found" });

  const doc = await getDocumentForTransaction(app, tx.id, tx.importId);
  if (!doc) return reply.code(404).send({ error: "document_not_found" });
  if (doc.userId !== id) return reply.code(403).send({ error: "forbidden" });

  let filename: string | null = doc.originalFilename;
  try {
    const parts = await gatherDocumentNaming(app, { doc, portfolioId, txId: tx.id });
    filename = buildDocumentName(parts);
  } catch {
    // Non-fatal: fall back to originalFilename.
  }

  const url = await app.storage.getSignedUrl(doc.storageKey, undefined, {
    downloadName: filename ?? undefined,
  });
  return { url, filename, mimeType: doc.mimeType };
}

export async function handleSourceDocumentUrl(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const id = request.userId;
  const { portfolioId, txId, sourceId } = request.params as {
    portfolioId: string;
    txId: string;
    sourceId: string;
  };

  const [tx] = await app.db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.id, txId), eq(transactions.portfolioId, portfolioId)))
    .limit(1);
  if (!tx) return reply.code(404).send({ error: "transaction_not_found" });

  let doc: {
    id: string;
    storageKey: string;
    originalFilename: string | null;
    mimeType: string;
    source: string | null;
    storedAt: Date;
    importId: string | null;
    transactionId: string | null;
    userId: string;
  } | null;

  if (sourceId.startsWith("doc:")) {
    const documentId = sourceId.slice("doc:".length);
    const [row] = await app.db
      .select({
        id: documents.id,
        storageKey: documents.storageKey,
        originalFilename: documents.originalFilename,
        mimeType: documents.mimeType,
        source: documents.source,
        storedAt: documents.storedAt,
        importId: documents.importId,
        transactionId: documents.transactionId,
        userId: documents.userId,
      })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.transactionId, txId)))
      .limit(1);
    doc = row ?? null;
  } else {
    const [sourceRow] = await app.db
      .select({
        id: transactionSources.id,
        documentId: transactionSources.documentId,
        importId: transactionSources.importId,
      })
      .from(transactionSources)
      .where(and(eq(transactionSources.id, sourceId), eq(transactionSources.transactionId, txId)))
      .limit(1);
    if (!sourceRow) return reply.code(404).send({ error: "source_not_found" });

    if (sourceRow.documentId) {
      const [row] = await app.db
        .select({
          id: documents.id,
          storageKey: documents.storageKey,
          originalFilename: documents.originalFilename,
          mimeType: documents.mimeType,
          source: documents.source,
          storedAt: documents.storedAt,
          importId: documents.importId,
          transactionId: documents.transactionId,
          userId: documents.userId,
        })
        .from(documents)
        .where(eq(documents.id, sourceRow.documentId))
        .limit(1);
      doc = row ?? null;
    } else {
      doc = await getDocumentForTransaction(app, txId, sourceRow.importId);
    }
  }
  if (!doc) return reply.code(404).send({ error: "document_not_found" });
  if (doc.userId !== id) return reply.code(403).send({ error: "forbidden" });

  let filename: string | null = doc.originalFilename;
  try {
    const parts = await gatherDocumentNaming(app, { doc, portfolioId, txId });
    filename = buildDocumentName(parts);
  } catch {
    // Non-fatal: fall back to originalFilename.
  }

  const url = await app.storage.getSignedUrl(doc.storageKey, undefined, {
    downloadName: filename ?? undefined,
  });
  return { url, filename, mimeType: doc.mimeType };
}
