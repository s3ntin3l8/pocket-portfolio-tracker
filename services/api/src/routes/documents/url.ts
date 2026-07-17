import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getInboxDocument } from "../../storage/inbox.js";

export async function handleDocumentUrl(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const id = request.userId;
  const doc = await getInboxDocument(app, (request.params as { documentId: string }).documentId);
  if (!doc) return reply.code(404).send({ error: "document_not_found" });
  if (doc.userId !== id) return reply.code(403).send({ error: "forbidden" });

  const url = await app.storage.getSignedUrl(doc.storageKey, undefined, {
    downloadName: doc.originalFilename ?? undefined,
  });
  return { url, filename: doc.originalFilename, mimeType: doc.mimeType };
}
