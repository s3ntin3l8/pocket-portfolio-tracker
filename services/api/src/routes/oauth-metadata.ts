import type { FastifyInstance } from "fastify";

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) for the MCP endpoint, so AI connectors
 * (claude.ai, mobile) can discover which authorization server to use. Registered only when
 * the connector is configured (`PUBLIC_API_URL` + `AUTHENTIK_MCP_AUDIENCE` + an issuer);
 * otherwise `/mcp` stays personal-access-token only. The authorization server is Authentik —
 * this API only verifies the tokens it issues (see `plugins/auth.ts`).
 */
export async function oauthMetadataRoute(app: FastifyInstance) {
  const base = app.config.PUBLIC_API_URL.trim().replace(/\/+$/, "");
  const issuer = app.config.AUTHENTIK_MCP_ISSUER || app.config.AUTHENTIK_ISSUER;
  if (!base || !app.config.AUTHENTIK_MCP_AUDIENCE || !issuer) return;

  const metadata = {
    resource: `${base}/mcp`,
    authorization_servers: [issuer],
    // `openid`/`email` identify the user; the write scope upgrades the token from read-only to
    // the draft-only write tools.
    scopes_supported: ["openid", "email", "profile", app.config.MCP_WRITE_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Pocket",
  };

  // The spec derives the metadata URL from the resource path (`/mcp`), with the bare form as a
  // fallback some clients try first. Public, cacheable, no credentials.
  for (const path of [
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/oauth-protected-resource",
  ]) {
    app.get(path, async (_request, reply) =>
      reply
        .header("cache-control", "public, max-age=300")
        .header("access-control-allow-origin", "*")
        .send(metadata),
    );
  }
}
