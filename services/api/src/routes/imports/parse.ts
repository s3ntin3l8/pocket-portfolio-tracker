import type { FastifyInstance } from "fastify";
import { handleCsvUpload } from "./parse/csv-handler.js";
import { handleScreenshotUpload } from "./parse/screenshot-handler.js";
import { registerMaterializeRoutes } from "./materialize.js";

export function registerParseImportRoutes(app: FastifyInstance) {
  app.post(
    "/imports/csv",
    { preHandler: app.authenticate, bodyLimit: 25 * 1024 * 1024 },
    (request, reply) => handleCsvUpload(app, request, reply),
  );

  // 30 MB request body — 5 MB headroom over the multipart `fileSize` cap of
  // 25 MB (see app.ts:189). Without this override Fastify's default 1 MB
  // bodyLimit fires first and rejects every screenshot before the multipart
  // parser can return the in-route "file_too_large" 413. #S3
  app.post(
    "/imports/screenshot",
    { preHandler: app.authenticate, bodyLimit: 30 * 1024 * 1024 },
    (request, reply) => handleScreenshotUpload(app, request, reply),
  );

  registerMaterializeRoutes(app);
}
