import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getInboxDocument, deleteInboxDocument } from "../../storage/inbox.js";

export async function handleDeleteDocument(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const id = request.userId;
  const doc = await getInboxDocument(app, (request.params as { documentId: string }).documentId);
  if (!doc) return reply.code(404).send({ error: "document_not_found" });
  if (doc.userId !== id) return reply.code(403).send({ error: "forbidden" });

  await deleteInboxDocument(app, { documentId: doc.id, storageKey: doc.storageKey });
  request.log.info({ documentId: doc.id }, "inbox document deleted");
  reply.code(204);
  return null;
}
