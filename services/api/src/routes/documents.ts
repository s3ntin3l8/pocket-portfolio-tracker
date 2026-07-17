import type { FastifyInstance } from "fastify";
import { handleListDocuments } from "./documents/list.js";
import { handleUploadDocument } from "./documents/upload.js";
import { handleDocumentUrl } from "./documents/url.js";
import { handleDeleteDocument } from "./documents/delete.js";
import { handleTxDocumentUrl, handleSourceDocumentUrl } from "./documents/tx.js";
import { handleExportDocuments } from "./documents/export.js";

export async function documentsRoute(app: FastifyInstance) {
  app.get("/documents", { preHandler: app.authenticate }, (request, reply) =>
    handleListDocuments(app, request, reply),
  );

  app.post("/documents", { preHandler: app.authenticate }, (request, reply) =>
    handleUploadDocument(app, request, reply),
  );

  app.get<{ Params: { documentId: string } }>(
    "/documents/:documentId/url",
    { preHandler: app.authenticate },
    (request, reply) => handleDocumentUrl(app, request, reply),
  );

  app.delete<{ Params: { documentId: string } }>(
    "/documents/:documentId",
    { preHandler: app.authenticate },
    (request, reply) => handleDeleteDocument(app, request, reply),
  );

  app.get<{ Params: { portfolioId: string; txId: string } }>(
    "/portfolios/:portfolioId/transactions/:txId/document-url",
    { preHandler: [app.authenticate, app.requirePortfolio] },
    (request, reply) => handleTxDocumentUrl(app, request, reply),
  );

  app.get<{ Params: { portfolioId: string; txId: string; sourceId: string } }>(
    "/portfolios/:portfolioId/transactions/:txId/sources/:sourceId/document-url",
    { preHandler: [app.authenticate, app.requirePortfolio] },
    (request, reply) => handleSourceDocumentUrl(app, request, reply),
  );

  app.get<{ Params: { portfolioId: string } }>(
    "/portfolios/:portfolioId/documents/export",
    { preHandler: [app.authenticate, app.requirePortfolio] },
    (request, reply) => handleExportDocuments(app, request, reply),
  );
}
