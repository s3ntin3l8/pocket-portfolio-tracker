import Fastify from "fastify";
import type { FastifyBaseLogger } from "fastify";
import pino from "pino";
import type { DestinationStream } from "pino";
import pinoRoll from "pino-roll";
import compress from "@fastify/compress";
import sensible from "@fastify/sensible";
import multipart from "@fastify/multipart";
import { ZodError } from "zod";
import { FxRateMissingError } from "@portfolio/core";
import { currentFxMissing, runInFxMissingScope } from "./lib/fx-missing.js";
import { runInFxCachedOnlyScope } from "./lib/fx-cached-only.js";
import { envPlugin } from "./plugins/env.js";
import { loggingPlugin } from "./plugins/logging.js";
import { securityPlugin } from "./plugins/security.js";
import { dbPlugin } from "./plugins/db.js";
import { authPlugin, isReadOnlyPat, type AuthPluginOptions } from "./plugins/auth.js";
import { rootRoute } from "./routes/root.js";
import { healthRoute } from "./routes/health.js";
import { meRoute } from "./routes/me.js";
import { portfoliosRoute } from "./routes/portfolios.js";
import { accountHoldersRoute } from "./routes/account-holders.js";
import { transactionsRoute } from "./routes/transactions.js";
import { loansRoute } from "./routes/loans.js";
import { instrumentsRoute } from "./routes/instruments.js";
import { quotesRoute } from "./routes/quotes.js";
import { internalMarketDataRoute } from "./routes/internal-market-data.js";
import { corporateActionsRoute } from "./routes/corporate-actions.js";
import { mergersRoute } from "./routes/mergers.js";
import { importsRoute } from "./routes/imports.js";
import { documentsRoute } from "./routes/documents.js";
import { trRoute } from "./routes/tr.js";
import { ibkrRoute } from "./routes/ibkr.js";
import { adminRoute } from "./routes/admin.js";
import { searchRoute } from "./routes/search.js";
import { mcpRoute } from "./routes/mcp.js";
import { oauthMetadataRoute } from "./routes/oauth-metadata.js";
import { assistantRoute } from "./routes/assistant.js";
import { getChatProvider } from "./services/chat/registry.js";
import type { ChatProvider } from "./services/chat/types.js";
import { storageRoute } from "./routes/storage.js";
import { targetsRoute } from "./routes/targets.js";
import { preferencesRoute } from "./routes/preferences.js";
import { authRoute } from "./routes/auth.js";
import type { ScreenshotParser } from "./services/parsers/types.js";
import { getScreenshotParser } from "./services/screenshot-parser.js";
import { getPytrRunner } from "./services/pytr/runner.js";
import type { PytrRunner } from "./services/pytr/runner.js";
import { createFlexClient } from "./services/ibkr/flex-client.js";
import type { IbkrFlexClient } from "./services/ibkr/flex-client.js";
import type { StorageProvider } from "./storage/types.js";
import { storagePlugin } from "./plugins/storage.js";
import { clearValuationCache } from "./services/valuation.js";
import { clearDerivationCache } from "./lib/derivation-cache.js";

export type BuildAppOptions = AuthPluginOptions & {
  // Injectable so tests can supply a mock parser instead of hitting Anthropic.
  screenshotParser?: ScreenshotParser;
  /** Test seam for the assistant: an instance, or `null` for "not configured". Omitted = resolve from settings/env. */
  chatProvider?: ChatProvider | null;
  // Injectable so tests drive the pytr boundary without spawning Python.
  pytr?: PytrRunner;
  // Injectable so tests can mock the IBKR Flex client without real HTTP.
  ibkrFlex?: IbkrFlexClient;
  // Injectable so tests can supply a fake storage driver without hitting MinIO/S3.
  storage?: StorageProvider;
  /**
   * Test capture seam: pass an in-memory writable so test assertions can read NDJSON
   * log lines. Must NOT be used in production. Example:
   *   const lines: object[] = [];
   *   const logStream = { write(line: string) { lines.push(JSON.parse(line)); } };
   *   const app = await buildApp({ logStream });
   */
  logStream?: DestinationStream;
};

function trustedProxyConfig(): string[] | undefined {
  const raw = process.env.TRUSTED_PROXY_CIDRS?.trim();
  if (!raw) return undefined;
  return raw
    .split(",")
    .map((cidr) => cidr.trim())
    .filter((cidr) => cidr.length > 0);
}

/**
 * Resolve the pino destination stream.
 * - Tests pass an explicit logStream (in-memory capture) — returned as-is.
 * - When LOG_DIR is set in the environment, fan out to both stdout AND a rolling
 *   file (daily rotation, 20 MB size cap, 14 days of retention). Both sinks inherit
 *   the pino instance's `redact` config, so secrets never reach the file.
 * - Otherwise, log to stdout only (default and Docker/prod behaviour).
 */
export async function resolveLogDestination(
  injected?: DestinationStream,
): Promise<DestinationStream> {
  if (injected) return injected;

  const logDir = process.env.LOG_DIR?.trim();
  if (!logDir) return process.stdout;

  // pino-roll opens the file and rotates; the import is dynamic to avoid the
  // overhead + any file-handle leak in test runs (tests inject a stream directly).
  const rollStream = await pinoRoll({
    file: `${logDir}/api.log`,
    frequency: "daily",
    size: "20m",
    limit: { count: 14 },
    mkdir: true,
    sync: false,
  });

  return pino.multistream([{ stream: process.stdout }, { stream: rollStream }]);
}

/**
 * Request serializer for the access log. Mirrors Fastify's default shape but drops the
 * query string for `/storage/*`: those URLs are signed (`?exp=&sig=`) and the signature is a
 * bearer credential that must not be written to logs.
 */
export function serializeRequest(req: {
  method?: string;
  url?: string;
  originalUrl?: string;
  host?: string;
  hostname?: string;
  ip?: string;
  socket?: { remotePort?: number };
  remoteAddress?: string;
  remotePort?: number;
}) {
  const rawUrl = req.originalUrl ?? req.url ?? "";
  const url = /^\/storage(\/|\?|$)/.test(rawUrl) ? rawUrl.split("?")[0] : rawUrl;
  return {
    method: req.method,
    url,
    host: req.host ?? req.hostname,
    remoteAddress: req.ip ?? req.remoteAddress,
    remotePort: req.socket?.remotePort ?? req.remotePort,
  };
}

export async function buildApp(opts: BuildAppOptions = {}) {
  // Build the pino logger eagerly so we can (a) set redact paths at construction time
  // (they can't be patched in after the fact) and (b) accept a custom stream for test
  // log capture. The level is set from process.env here; loggingPlugin re-reconciles it
  // from the validated app.config after envPlugin runs.
  const loggerInstance = pino(
    {
      level: process.env.LOG_LEVEL || "info",
      redact: {
        paths: [
          // Standard HTTP fields emitted by Fastify's req/res serializers.
          "req.headers.authorization",
          "req.headers.cookie",
          // Vision-provider API keys (in-process, never in req headers; defence-in-depth).
          'req.headers["x-api-key"]',
          // Trade Republic credentials — passed via env to Python, logged in structured objs.
          "phone",
          "pin",
          "*.phone",
          "*.pin",
          "wafToken",
          "sessionData",
          // Encryption key — should never appear in logs, but guard the config object.
          "DB_ENCRYPTION_KEY",
          "config.DB_ENCRYPTION_KEY",
          // Generic credential-bearing field names (one level deep, like phone/pin above).
          "token",
          "password",
          "apiKey",
          "*.token",
          "*.password",
          "*.apiKey",
          // Local-auth and storage secrets, bare or nested under a config-like object.
          "AUTH_LOCAL_SECRET",
          "STORAGE_SECRET_KEY",
          "STORAGE_ACCESS_KEY",
          "*.AUTH_LOCAL_SECRET",
          "*.STORAGE_SECRET_KEY",
          "*.STORAGE_ACCESS_KEY",
          // Raw image/document bytes — log only `bytes` (length), never the base64 payload.
          "image",
          "data",
        ],
        censor: "[Redacted]",
      },
      serializers: { req: serializeRequest },
    },
    await resolveLogDestination(opts.logStream),
  );

  // Cast to FastifyBaseLogger: pino.Logger is a superset of FastifyBaseLogger. The cast
  // ensures Fastify infers `FastifyInstance<..., FastifyBaseLogger, ...>` consistently
  // with the rest of the codebase (server.ts, tests). Runtime behaviour is identical.
  const app = Fastify({
    loggerInstance: loggerInstance as FastifyBaseLogger,
    trustProxy: trustedProxyConfig(),
  });

  // Tolerate an empty application/json body. Fastify's default parser rejects a
  // request that advertises application/json with no body (FST_ERR_CTP_EMPTY_JSON_BODY
  // → 400), which breaks bodyless DELETEs from clients that always set the header.
  // Genuinely malformed JSON still surfaces as a 400.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (body === "" || body == null) return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      (err as { statusCode?: number }).statusCode = 400;
      done(err as Error, undefined);
    }
  });

  // Surface zod validation failures as 400s instead of 500s.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "validation_error", issues: error.issues });
    }
    // A value the column type can't parse — an id that isn't a UUID (`?holderId=x`), a
    // non-numeric amount that slipped past validation — reaches Postgres as an invalid cast:
    // SQLSTATE 22P02, raised directly or wrapped as a DrizzleQueryError's cause. That is a
    // malformed request, not a server error; the driver text is not echoed.
    if (isInvalidTextRepresentation(error)) {
      app.log.warn({ err: error }, "malformed value in request (22P02)");
      return reply.code(400).send({ error: "invalid_input" });
    }
    // Routes exclude what they can't convert and report `fxMissingCurrencies` (audit B2);
    // reaching here means a conversion path forgot to — a bug, logged distinctly.
    if (error instanceof FxRateMissingError) {
      app.log.error(
        { err: error, from: error.from, to: error.to },
        "unhandled missing FX rate: a route converted without excluding unconvertible rows",
      );
    } else {
      app.log.error(error);
    }
    const err = error as { statusCode?: number; message?: string };
    const statusCode = err.statusCode ?? 500;
    // Never echo the raw error message for a server error (unset statusCode, or >= 500) —
    // it can carry driver/DB internals (constraint/column names). Explicit 4xx errors
    // (validation, not-found, etc.) keep their message; detail stays server-side via the
    // app.log.error(error) above.
    if (statusCode >= 500) {
      return reply.code(statusCode).send({ error: "internal_error" });
    }
    return reply.code(statusCode).send({ error: err.message || "internal_error" });
  });

  // Missing-FX contract (audit B2): a conversion with no rate is never 1:1 and never a
  // failed request. Each request gets its own scope that every missing rate records into
  // (services/fx.ts); routes exclude the unconvertible rows, and this attaches the list to
  // any JSON object response as `fxMissingCurrencies` (and, for every response shape incl.
  // arrays, the `x-fx-missing-currencies` header). Absent when every rate resolved.
  // The same request scope carries the cached-only FX switch (audit A7): a read-scoped
  // PAT never makes a GET fetch or persist FX rates (lib/fx-cached-only.ts). Lazy, because
  // `request.user` is only set by the `authenticate` preHandler.
  app.addHook("onRequest", (request, _reply, done) => {
    runInFxMissingScope(() => runInFxCachedOnlyScope(() => isReadOnlyPat(request), done));
  });
  app.addHook("preSerialization", async (_request, reply, payload) => {
    const missing = currentFxMissing();
    if (missing.length === 0) return payload;
    reply.header("x-fx-missing-currencies", missing.join(","));
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const existing = (payload as { fxMissingCurrencies?: unknown }).fxMissingCurrencies;
      const merged = new Set([
        ...(Array.isArray(existing) ? (existing as string[]) : []),
        ...missing,
      ]);
      return { ...(payload as object), fxMissingCurrencies: [...merged].sort() };
    }
    return payload;
  });

  await app.register(envPlugin);
  await app.register(loggingPlugin);
  await app.register(sensible);
  // Gzip-compress responses >1 KB (large responses like income stats). The web proxy
  // (apps/web/src/app/api/backend/[...path]/route.ts) streams the compressed body
  // through unchanged, so browsers get the smaller payload directly.
  await app.register(compress, { global: true, threshold: 1024 });
  // Allow multipart/form-data uploads (screenshot imports). 25 MB per file; single file
  // per request. The limit is caught in-route (→ 413) to avoid leaking FST_* error codes.
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
  await app.register(securityPlugin);
  await app.register(dbPlugin);
  await app.register(authPlugin, opts);

  // Bust the whole valuation derivation cache (see services/valuation.ts) after any
  // write. There's no cheap per-portfolio version marker to invalidate precisely (no
  // `updatedAt` column on transactions — see valuePortfolioCached's doc comment), and
  // the routes that mutate portfolio data are spread across many files/shapes (some,
  // like undoing an import, key off an importId rather than a portfolioId in the URL),
  // so a global "any write clears everything" hook is the only invalidation that's
  // reliably correct rather than correct-until-someone-adds-a-route-that-forgets-to-
  // invalidate. Clearing the whole cache is cheap (a few Map entries) and only costs one
  // extra recompute per portfolio on the next read — never a staleness risk.
  app.addHook("onResponse", async (request, reply) => {
    // A POST that is itself read-only (`scope: "read"`, e.g. /mcp) never changes data.
    const readOnlyRoute = request.routeOptions?.config?.scope === "read";
    if (request.method !== "GET" && request.method !== "HEAD" && !readOnlyRoute) {
      clearValuationCache(request.log);
      clearDerivationCache();
    }
    if (process.env.TIMING_ENABLED === "true" && request.timingName) {
      request.log.info(
        { durationMs: Math.round(reply.elapsedTime * 100) / 100, ...request.timingMeta },
        `[timing] ${request.timingName}`,
      );
    }
  });

  // requireAdmin-gated routes (admin/*, instrument PATCH, corporate-actions writes)
  // become unreachable — including to the deployment's own owner — if no Authentik
  // group is configured to grant admin. Warn loudly at boot in production so this is
  // never a silent surprise; local/test envs don't need an admin group configured.
  if (app.config.NODE_ENV === "production" && !app.config.AUTHENTIK_ADMIN_GROUP) {
    app.log.warn(
      "AUTHENTIK_ADMIN_GROUP is unset — admin-only endpoints (admin/*, instrument edits, " +
        "corporate-action edits) will be unreachable by anyone, including the deployment " +
        "owner, until it's set to a real Authentik group.",
    );
  }

  const screenshotParser = opts.screenshotParser ?? (await getScreenshotParser());
  app.decorate("screenshotParser", screenshotParser);
  app.decorate(
    "resolveChatProvider",
    opts.chatProvider !== undefined ? async () => opts.chatProvider ?? null : getChatProvider,
  );
  // Log the selected vision provider once at startup (only for the real singleton, not
  // test-injected mocks — those are controlled by the test and shouldn't pollute logs).
  if (!opts.screenshotParser) {
    const pinned = !!process.env.SCREENSHOT_PARSER?.trim();
    app.log.info(
      { provider: screenshotParser.name, configured: screenshotParser.isConfigured(), pinned },
      "vision provider selected",
    );
  }

  app.decorate("pytr", opts.pytr ?? getPytrRunner(app.config, app.log));
  app.decorate(
    "ibkrFlex",
    opts.ibkrFlex ?? createFlexClient({ baseUrl: app.config.IBKR_FLEX_BASE_URL }),
  );

  // Storage — injectable in tests (pass opts.storage); the real plugin handles
  // bucket auto-creation on non-production environments so local MinIO just works.
  if (opts.storage) {
    app.decorate("storage", opts.storage);
  } else {
    await app.register(storagePlugin);
  }

  await app.register(rootRoute);
  await app.register(healthRoute);
  await app.register(authRoute);
  await app.register(meRoute);
  await app.register(portfoliosRoute);
  await app.register(accountHoldersRoute);
  await app.register(transactionsRoute);
  await app.register(loansRoute);
  await app.register(instrumentsRoute);
  await app.register(quotesRoute);
  await app.register(internalMarketDataRoute);
  await app.register(corporateActionsRoute);
  await app.register(mergersRoute);
  await app.register(importsRoute);
  await app.register(documentsRoute);
  await app.register(trRoute);
  await app.register(ibkrRoute);
  await app.register(adminRoute);
  await app.register(searchRoute);
  await app.register(mcpRoute);
  await app.register(oauthMetadataRoute);
  await app.register(assistantRoute);
  await app.register(targetsRoute);
  await app.register(preferencesRoute);
  // Public file-serving for the folder storage provider (no auth — token in query string).
  await app.register(storageRoute);

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    screenshotParser: ScreenshotParser;
    /** Resolves the assistant's chat provider per request; `null` when none is configured. */
    resolveChatProvider: () => Promise<ChatProvider | null>;
    pytr: PytrRunner;
    ibkrFlex: IbkrFlexClient;
    storage: StorageProvider;
  }
}

/** True for Postgres SQLSTATE 22P02 (invalid text representation), on the error or its cause. */
function isInvalidTextRepresentation(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 3; depth++) {
    if ((e as { code?: unknown }).code === "22P02") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
