import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { jwtVerify, createRemoteJWKSet } from "jose";
import type { JWTVerifyGetKey, JWTVerifyOptions } from "jose";
import { eq } from "drizzle-orm";
import { users, apiTokens } from "@portfolio/db";
import { ownedPortfolio } from "../routes/helpers.js";
import type { PortfolioWithHolder } from "../lib/portfolio.js";

// A key (local public key for tests) or a JWKS resolver function (remote, prod).
export type AuthKey = CryptoKey | Uint8Array | JWTVerifyGetKey;

/** Prefix that marks a personal access token, distinguishing it from a JWT (`eyJ…`). */
export const PAT_PREFIX = "pt_";

/** SHA-256 (hex) of a secret — what we store and look PATs up by; never the secret. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Methods a read-scoped PAT may not use. GET/HEAD/OPTIONS are always allowed.
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// --- Local password auth helpers ------------------------------------------------

const HASH_ALGO = "scrypt";
const HASH_KEYLEN = 64;
const HASH_SALT_BYTES = 16;

/** Hash a password with a random salt: `"scrypt:salt:hash"`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(HASH_SALT_BYTES).toString("hex");
  const derived = scryptSync(password, salt, HASH_KEYLEN).toString("hex");
  return `${HASH_ALGO}:${salt}:${derived}`;
}

/** Verify a password against a stored hash produced by `hashPassword`. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== HASH_ALGO) return false;
  const [, salt, hash] = parts;
  const derived = scryptSync(password, salt, HASH_KEYLEN).toString("hex");
  // Constant-time comparison to prevent timing attacks.
  return timingSafeEqual(Buffer.from(derived), Buffer.from(hash));
}

// Fixed dummy hash used by `timingSafeVerifyPassword` when the user doesn't exist or
// has no password set — ensures the "no account" and "wrong password" code paths take
// the same time (scrypt) so a timing attacker cannot distinguish registered emails.
const DUMMY_SALT = "0000000000000000";
const DUMMY_HASH = scryptSync("dummy-password", DUMMY_SALT, HASH_KEYLEN).toString("hex");
const DUMMY_PASSWORD_HASH = `${HASH_ALGO}:${DUMMY_SALT}:${DUMMY_HASH}`;

/**
 * Verify a password, or run a dummy scrypt round to mask whether the user exists.
 * Returns false when the user/passwordHash is missing (after paying the scrypt cost),
 * so the caller cannot distinguish "no such user" from "wrong password" by timing.
 */
export function timingSafeVerifyPassword(
  password: string,
  stored: string | null | undefined,
): boolean {
  if (!stored) {
    // Pay the scrypt cost against the dummy hash so both paths take ~same time.
    verifyPassword(password, DUMMY_PASSWORD_HASH);
    return false;
  }
  return verifyPassword(password, stored);
}

/**
 * A lazy JWKS resolver that discovers the signing keys from the issuer via OIDC
 * discovery (`<issuer>/.well-known/openid-configuration` → `jwks_uri`). Lets the API
 * be configured with only AUTHENTIK_ISSUER — no separate AUTHENTIK_JWKS_URL. Discovery
 * runs once, on the first token verification, then the JWKS is cached (and refreshed
 * by `createRemoteJWKSet` as needed). Injectable fetch keeps it unit-testable.
 */
export function createIssuerJwks(
  issuer: string,
  fetchImpl: typeof fetch = fetch,
  // The JWKS builder is a seam so tests can avoid a real network fetch.
  buildJwks: (jwksUri: URL) => JWTVerifyGetKey = createRemoteJWKSet,
): JWTVerifyGetKey {
  let jwks: JWTVerifyGetKey | null = null;
  const base = issuer.endsWith("/") ? issuer : `${issuer}/`;
  return async (protectedHeader, token) => {
    if (!jwks) {
      const res = await fetchImpl(new URL(".well-known/openid-configuration", base));
      if (!res.ok) throw new Error(`oidc_discovery_failed_${res.status}`);
      const doc = (await res.json()) as { jwks_uri?: string };
      if (!doc.jwks_uri) throw new Error("oidc_no_jwks_uri");
      jwks = buildJwks(new URL(doc.jwks_uri));
    }
    return jwks(protectedHeader, token);
  };
}

export interface AuthPluginOptions {
  authKey?: AuthKey;
}

export interface AuthedUser {
  id: string;
  authSub: string;
  // Derived from the Authentik `groups` claim each request — not stored on the row.
  isAdmin: boolean;
  // How this request authenticated: an interactive Authentik session ("jwt"), a local
  // password login ("local"), or a personal access token ("pat"). Minting a new PAT
  // requires an interactive session ("jwt" or "local").
  authMethod: "jwt" | "local" | "pat";
  // "write" for interactive sessions; a PAT carries its own (read-only by default).
  scope: "read" | "write";
}

/** Returns the authenticated user or throws — use inside `authenticate`d handlers. */
export function requireUser(request: FastifyRequest): AuthedUser {
  if (!request.user) throw new Error("unauthenticated");
  return request.user;
}

/**
 * Authentik OIDC auth. Verifies a Bearer JWT (remote JWKS in prod, an injected key
 * in tests), then upserts the user by `sub` and sets `request.user`. The actual
 * per-route guard is the decorated `app.authenticate` preHandler.
 */
export const authPlugin = fp<AuthPluginOptions>(async (app: FastifyInstance, opts) => {
  // Prefer an injected key (tests); else an explicit JWKS URL; else derive the JWKS
  // from the issuer via OIDC discovery so AUTHENTIK_JWKS_URL is optional.
  // When neither OIDC path is configured, check for local password auth (AUTH_LOCAL_SECRET)
  // which uses a symmetric HMAC key instead of a remote JWKS.
  const usingInjectedKey = opts.authKey != null;
  const keyResolver: AuthKey | null =
    opts.authKey ??
    (app.config.AUTHENTIK_JWKS_URL
      ? createRemoteJWKSet(new URL(app.config.AUTHENTIK_JWKS_URL))
      : app.config.AUTHENTIK_ISSUER
        ? createIssuerJwks(app.config.AUTHENTIK_ISSUER)
        : null);

  // Local auth symmetric key — used alongside OIDC or as standalone fallback.
  const usingLocalAuth = app.config.AUTH_LOCAL_SECRET !== "";
  const localJwtKey: Uint8Array | null = usingLocalAuth
    ? new TextEncoder().encode(app.config.AUTH_LOCAL_SECRET)
    : null;

  // Fail closed for OIDC: a real deployment (no injected test key) must bind every token
  // to THIS service via both issuer and audience to prevent cross-client token reuse.
  // Local auth uses a private symmetric key so this check doesn't apply.
  if (keyResolver && !usingInjectedKey) {
    const missing = [
      !app.config.AUTHENTIK_ISSUER && "AUTHENTIK_ISSUER",
      !app.config.AUTHENTIK_AUDIENCE && "AUTHENTIK_AUDIENCE",
    ].filter((x): x is string => Boolean(x));
    if (missing.length > 0) {
      throw new Error(
        `Authentication is configured but ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set — ` +
          `refusing to start with signature-only token validation`,
      );
    }
  }

  const anyAuthConfigured = keyResolver != null || localJwtKey != null;

  app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "missing_token" });
    }
    const token = header.slice(7);

    // Personal access token: our own long-lived credential, looked up by hash on a
    // unique index (no timing-unsafe secret comparison). PATs carry their own scope;
    // the secret is never logged. This check runs before the JWT guards below so PATs
    // work independently of any OIDC or local auth config. PATs never grant admin
    // outside local development — a leaked PAT must not be an admin credential in any
    // real deployment (test included, so this stays covered by the "never" tests).
    if (token.startsWith(PAT_PREFIX)) {
      const [row] = await app.db
        .select()
        .from(apiTokens)
        .where(eq(apiTokens.tokenHash, hashToken(token)))
        .limit(1);
      if (!row || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) {
        return reply.code(401).send({ error: "invalid_token" });
      }
      const [u] = await app.db.select().from(users).where(eq(users.id, row.userId)).limit(1);
      if (!u) return reply.code(401).send({ error: "invalid_token" });
      // Stamp last-used (one indexed UPDATE) so the token list shows activity.
      await app.db
        .update(apiTokens)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiTokens.id, row.id));
      const scope = row.scope === "write" ? "write" : "read";
      if (scope === "read" && MUTATING_METHODS.has(request.method)) {
        return reply.code(403).send({ error: "read_only_token" });
      }
      request.user = {
        id: u.id,
        authSub: u.authSub,
        // DEV_AUTH_TOKEN (see seed-demo.ts) is a PAT, so this is the only way the
        // local dev bypass can ever see admin-only screens (storage/providers/etc.).
        isAdmin: app.config.NODE_ENV === "development",
        authMethod: "pat",
        scope,
      };
      request.userId = u.id;
      return;
    }

    // JWT verification — try OIDC first, then local auth, in case both are configured.
    let sub: string | undefined;
    let email: string | undefined;
    let isAdmin = false;
    let authMethod: AuthedUser["authMethod"] | undefined;

    // Try OIDC (remote JWKS / issuer OIDC discovery)
    if (keyResolver) {
      try {
        const verifyOpts: JWTVerifyOptions = {
          issuer: app.config.AUTHENTIK_ISSUER || undefined,
          audience: app.config.AUTHENTIK_AUDIENCE || undefined,
        };
        const { payload } =
          typeof keyResolver === "function"
            ? await jwtVerify(token, keyResolver, verifyOpts)
            : await jwtVerify(token, keyResolver, verifyOpts);
        if (payload.sub) {
          sub = payload.sub;
          email = typeof payload.email === "string" ? payload.email : `${sub}@users.noreply`;
          const groups = Array.isArray(payload.groups) ? payload.groups : [];
          const adminGroup = app.config.AUTHENTIK_ADMIN_GROUP;
          isAdmin = adminGroup !== "" && groups.includes(adminGroup);
          authMethod = "jwt";
        }
      } catch {
        // OIDC verification failed — fall through to local auth if configured
      }
    }

    // Try local auth (symmetric HS256 JWT signed by /auth/local/login)
    if (!authMethod && localJwtKey) {
      try {
        const { payload } = await jwtVerify(token, localJwtKey);
        if (payload.sub) {
          sub = payload.sub;
          email = typeof payload.email === "string" ? payload.email : `${sub}@users.noreply`;
          authMethod = "local";
        }
      } catch {
        // Local verification failed — fall through to error
      }
    }

    if (!sub || !authMethod) {
      if (!anyAuthConfigured) {
        return reply.code(503).send({ error: "auth_not_configured" });
      }
      return reply.code(401).send({ error: "invalid_token" });
    }

    const [found] = await app.db.select().from(users).where(eq(users.authSub, sub!)).limit(1);
    let user = found;
    if (!user) {
      const [created] = await app.db
        .insert(users)
        .values({ authSub: sub!, email: email! })
        .returning();
      user = created;
    }
    request.user = {
      id: user.id,
      authSub: user.authSub,
      isAdmin,
      authMethod,
      scope: "write",
    };
    request.userId = user.id;
  });

  // Admin-only guard: authenticate, then require the Authentik admin group. Used by
  // /admin routes that mutate server-wide config (data-provider settings).
  app.decorate("requireAdmin", async (request: FastifyRequest, reply: FastifyReply) => {
    await app.authenticate(request, reply);
    // authenticate already sent an error response (401/503) — don't continue.
    if (reply.sent) return reply;
    if (!request.user?.isAdmin) {
      return reply.code(403).send({ error: "forbidden" });
    }
  });

  app.decorate(
    "requirePortfolio",
    async function (this: FastifyInstance, request: FastifyRequest, reply: FastifyReply) {
      const { portfolioId } = request.params as { portfolioId?: string };
      if (!portfolioId) return reply.code(400).send({ error: "portfolio_id_required" });
      const portfolio = await ownedPortfolio(this, request.userId, portfolioId);
      if (!portfolio) return reply.code(404).send({ error: "portfolio_not_found" });
      request.portfolio = portfolio;
    },
  );
});

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
    requirePortfolio: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  }
  interface FastifyRequest {
    user?: AuthedUser;
    userId: string;
    portfolio: PortfolioWithHolder;
    timingMeta?: Record<string, unknown>;
    timingName?: string;
  }
}
