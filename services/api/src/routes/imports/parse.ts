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

  app.post("/imports/screenshot", { preHandler: app.authenticate }, (request, reply) =>
    handleScreenshotUpload(app, request, reply),
  );

  registerMaterializeRoutes(app);
}
