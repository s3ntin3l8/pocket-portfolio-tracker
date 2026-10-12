import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import { createHash } from "node:crypto";

export const securityPlugin = fp(async (app: FastifyInstance) => {
  // Security headers (CSP, HSTS, etc.).
  await app.register(helmet);

  // Basic abuse protection. Tune via RATE_LIMIT_MAX / RATE_LIMIT_WINDOW.
  // Keyed per credential, not per IP: the web tier's server-side loaders all share one
  // egress IP, so an IP key made every user count against one bucket. The key is a hash
  // of the raw Authorization header — NOT the (unverified at this stage) JWT `sub`, which
  // anyone could forge to exhaust a victim's bucket. Unauthenticated requests fall back
  // to the client IP.
  await app.register(rateLimit, {
    max: app.config.RATE_LIMIT_MAX,
    timeWindow: app.config.RATE_LIMIT_WINDOW,
    keyGenerator: (request) => {
      const auth = request.headers.authorization;
      if (typeof auth === "string" && /^bearer\s+\S/i.test(auth)) {
        return `cred:${createHash("sha256").update(auth).digest("hex")}`;
      }
      return request.ip;
    },
  });

  // CORS is disabled by default. Set CORS_ORIGIN to a comma-separated allowlist
  // (e.g. "https://app.example.com,https://admin.example.com") to enable it.
  const allowlist = app.config.CORS_ORIGIN.split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);

  await app.register(cors, {
    origin: allowlist.length > 0 ? allowlist : false,
    // @fastify/cors defaults to GET,HEAD,POST — must allow PATCH (e.g. PATCH /me) and
    // future PUT/DELETE so cross-origin browser preflights don't block those methods.
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
  });
});
