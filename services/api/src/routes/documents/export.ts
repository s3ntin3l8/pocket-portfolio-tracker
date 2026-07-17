import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { and, eq } from "drizzle-orm";
import { documents, portfolios } from "@portfolio/db";
import { gatherDocumentNaming, buildDocumentName } from "../../storage/naming.js";

function dedupeFilename(name: string, usedNames: Set<string>): string {
  if (!usedNames.has(name)) {
    usedNames.add(name);
    return name;
  }
  const dotIdx = name.lastIndexOf(".");
  const base = dotIdx >= 0 ? name.slice(0, dotIdx) : name;
  const ext = dotIdx >= 0 ? name.slice(dotIdx) : "";
  let n = 2;
  let candidate = `${base}-${n}${ext}`;
  while (usedNames.has(candidate)) {
    n++;
    candidate = `${base}-${n}${ext}`;
  }
  usedNames.add(candidate);
  return candidate;
}

export async function handleExportDocuments(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { portfolioId } = request.params as { portfolioId: string };

  const docs = await app.db
    .select({
      id: documents.id,
      storageKey: documents.storageKey,
      mimeType: documents.mimeType,
      originalFilename: documents.originalFilename,
      source: documents.source,
      storedAt: documents.storedAt,
      importId: documents.importId,
      transactionId: documents.transactionId,
      userId: documents.userId,
    })
    .from(documents)
    .where(and(eq(documents.portfolioId, portfolioId), eq(documents.status, "retained")));

  if (docs.length === 0) {
    return reply.code(404).send({ error: "no_documents" });
  }

  const usedNames = new Set<string>();

  const { zipSync } = await import("fflate");
  const entries: Record<string, Uint8Array> = {};

  for (const doc of docs) {
    let entryName: string;
    try {
      const parts = await gatherDocumentNaming(app, { doc, portfolioId });
      entryName = buildDocumentName(parts);
    } catch {
      entryName = doc.originalFilename ?? `document_${doc.id.slice(0, 8)}`;
    }
    entryName = dedupeFilename(entryName, usedNames);

    const buf = await app.storage.get(doc.storageKey);
    if (!buf) {
      app.log.warn({ docId: doc.id, key: doc.storageKey }, "export: object not found, skipping");
      continue;
    }
    entries[entryName] = new Uint8Array(buf);
  }

  const [portfolio] = await app.db
    .select({ name: portfolios.name })
    .from(portfolios)
    .where(eq(portfolios.id, portfolioId))
    .limit(1);

  const archiveName = portfolio
    ? `${portfolio.name.replace(/[^\w-]/g, "-")}_documents.zip`
    : "documents.zip";

  const zipped = zipSync(entries);

  void reply.header("Content-Type", "application/zip");
  void reply.header("Content-Disposition", `attachment; filename="${archiveName}"`);
  void reply.header("Content-Length", String(zipped.length));
  return reply.code(200).send(Buffer.from(zipped));
}
