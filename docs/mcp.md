# AI assistant access (MCP)

Pocket exposes a **read-only** [Model Context Protocol](https://modelcontextprotocol.io) endpoint so an AI
assistant (Claude Code, Claude Desktop, any MCP client) can read and explain your portfolio.

- **Endpoint:** `POST /mcp` on the API (Streamable HTTP, stateless, JSON responses). `GET`/`DELETE` answer 405.
- **Auth:** a normal Bearer credential. For assistants, create a **read-only personal access token** in
  Settings → Data & connections. A read-scoped token may call `/mcp` even though it is a `POST`
  (`config: { scope: "read" }` on the route — see `plugins/auth.ts`); everything a tool does goes back through
  the API in-process and is gated like any other request.
- **Reachability in the Docker prod stack:** the API has no public ingress by default (the browser goes through the
  web app's same-origin proxy, which drops a client `Authorization` header), so `https://<web-host>/mcp` answers with a
  redirect/404 from the web app until you opt in. Enable the commented-out `api` block in your gitignored
  `docker-compose.prod.override.yml` (template: `docker-compose.prod.override.example.yml`): a path-scoped Traefik router
  that exposes only `/mcp` and `/.well-known/oauth-protected-resource*`; every other API route stays internal. Then
  `POST /mcp` without a credential should answer `401` with a `WWW-Authenticate` header.
- **Transport security:** the token is a bearer credential — always use an `https://` API address. (TLS normally terminates at the reverse proxy, so the API itself does not enforce it.)
- **Tools:** the 17 tools in `packages/ai-tools` (portfolios, net worth, summary, holdings, transaction search,
  value history, income, contributions, tax, targets/drift, insights, instrument lookup, plus the five below),
  the `pocket://glossary` resource and three prompts (`monthly_review`, `tax_year_check`, `rebalancing_plan`).

  | Tool                          | What it adds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
  | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `get_rebalancing` + `newCash` | A what-if: a positive decimal string in the display currency, split buy-only over the under-target buckets in proportion to their target weights (`GET /networth/rebalancing`, `GET /portfolios/:id/rebalancing`; core does the maths).                                                                                                                                                                                                                                                               |
  | `explain_tax_concept`         | Static, reviewed text for Vorabpauschale, Teilfreistellung, Basiszins, FSA, Sparerpauschbetrag and the loss pots. Regime-aware: a user on the Indonesian regime gets a "German regime only" caveat. No live rates or user figures; those come from `get_tax_summary`.                                                                                                                                                                                                                                 |
  | `get_fsa_allocation`          | Per-depot FSA allocated / used / remaining plus the holder's cap (ids only, no portfolio or holder names). Advisory: changing an allocation is a Settings action.                                                                                                                                                                                                                                                                                                                                     |
  | `resolve_instrument`          | Provider search / ISIN resolution (`GET /instruments/lookup`) for instruments Pocket does not know yet, up to 10 candidates. `lookup_instrument` stays for known ones.                                                                                                                                                                                                                                                                                                                                |
  | `explain_import_duplicates`   | Which drafts of an import were flagged as likely duplicates (`GET /imports/:id`, so no write-scope change) and what `enrichment` vs `duplicate` mean.                                                                                                                                                                                                                                                                                                                                                 |
  | `check_integrity`             | Runs the analysis-integrity invariants over the caller's own data (`GET /me/integrity`, `docs/integrity.md`) and returns what broke: rule, scope, expected vs actual. Evidence that two figures disagree, not a verdict on which is wrong; the model reports it as given and never recomputes. Up to 20 findings (taken across rules, so one noisy rule cannot hide another) plus a per-rule count, and `abstentions`: where a rule skipped data, which is not a pass. Can be slow on large accounts. |

## Connect

```bash
# Claude Code
claude mcp add --transport http pocket https://<your-pocket-api>/mcp \
  --header "Authorization: Bearer <token>"
```

```jsonc
// Claude Desktop: claude_desktop_config.json (via the mcp-remote bridge)
{
  "mcpServers": {
    "pocket": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote@0.14.3",
        "https://<your-pocket-api>/mcp",
        "--header",
        "Authorization: Bearer <token>",
      ],
    },
  },
}
```

## Connect claude.ai / mobile (OAuth)

claude.ai's custom connectors (and the Claude mobile apps) sign in with OAuth instead of a pasted token. Pocket does
not run an authorization server: **Authentik** is the server, Pocket only verifies the tokens it issues. This needs
Authentik; deployments on local email/password auth use a personal access token with Claude Code / Desktop instead
(an authorization server for those is [#970](https://github.com/s3ntin3l8/pocket-portfolio-tracker/issues/970)).

1. **Authentik provider.** Create an OAuth2/OpenID provider (confidential client) with the redirect URI
   `https://claude.ai/api/mcp/auth_callback` and the scopes `openid`, `email`, `profile`. Use the same signing key and
   the same _subject mode_ as Pocket's main provider so the connector resolves to the same Pocket user. Note the
   client ID and secret.
2. **Write access (optional).** Add a scope mapping named `pocket:write` and select it on the provider to let the
   connector use the [draft-only write tool](#draft-only-write-tool). Leave it out and the connector is read-only.
   Mind what it grants: the token is audience-bound to the connector, not to `/mcp`, so a write-scoped token is as
   powerful as a write personal access token on every REST route (the _tools_ only offer drafts, the bearer can do
   more if it leaks). Grant it only if you want that.
3. **Authentik application.** Create an application for the provider (e.g. slug `claude-connector`) and **bind the
   group/policy of people allowed to connect** — treat that binding as required, not optional. A connector token acts
   only for a user who already has a Pocket account (it never creates one: `401 account_required` until they have
   logged in to the web app once).
4. **Pocket.** Set (see `.env.example`):

   | Variable                 | Value                                                                                                                                                             |
   | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `AUTHENTIK_MCP_AUDIENCE` | the connector provider's **client ID** (Authentik puts it in the token's `aud`)                                                                                   |
   | `AUTHENTIK_MCP_ISSUER`   | that provider's issuer, e.g. `https://auth.example.com/application/o/claude-connector/` (it contains the application slug, so it differs from `AUTHENTIK_ISSUER`) |
   | `PUBLIC_API_URL`         | the public origin of the API, e.g. `https://api.example.com`                                                                                                      |
   | `MCP_WRITE_SCOPE`        | optional; default `pocket:write`                                                                                                                                  |

   `/mcp` and `/.well-known/oauth-protected-resource` must be reachable from the internet at that origin's root.

5. **claude.ai.** Settings → Connectors → _Add custom connector_ with `https://api.example.com/mcp`. If your Authentik
   does not offer dynamic client registration, open _Advanced settings_ and enter the provider's client ID and secret.

How it works: an unauthenticated `POST /mcp` answers `401` with
`WWW-Authenticate: Bearer resource_metadata="<PUBLIC_API_URL>/.well-known/oauth-protected-resource/mcp"`; that document
(RFC 9728) names the Authentik issuer as the authorization server, and the client runs the OAuth flow there.

A connector token is treated **like a personal access token**: read-only unless it carries `MCP_WRITE_SCOPE` (the
`scope` or `scp` claim), accepted on the same routes, **never admin**, and — like a PAT — it cannot mint tokens or
change the password (`interactive_session_required`). It is verified against the connector's own issuer and audience;
a token for any other audience is rejected, and a connector token is not accepted as a web login or vice versa. Because
the two providers share a signing key, the **audience is the only separation** between the paths: never reuse the
connector's client ID as `AUTHENTIK_AUDIENCE`, and keep the two providers' client IDs distinct.
Without `AUTHENTIK_MCP_AUDIENCE` none of this is active and `/mcp` stays PAT-only.

## Design rules

- **The model narrates; it never computes.** Tools return figures derived in `packages/core` with their
  qualifiers (gain basis, `valuedAtCost`, `fxMissingCurrencies`, `cashCounted`). The glossary is sent as the
  server `instructions` so clients put those rules in the model's context.
- **Redaction at the boundary.** Every tool output is deep-stripped of sensitive keys (account numbers, IBANs,
  user ids, credentials), holder names are replaced by ids, transaction memos are not returned, and IBAN-shaped
  text is scrubbed (`packages/ai-tools/src/redact.ts`).
- **Failures are data, not exceptions:** a failing call returns `{ error, status }` (flagged `isError`), never the
  response body or a stack.
- Each tool call is an in-process API request, so it counts against the per-credential rate limit (1 for the
  `/mcp` POST plus 1-2 for the tool's API calls; a 429 comes back to the model as a tool error) and stamps the
  token's `lastUsedAt`.
- Tool ids are validated as GUIDs, so a tool argument can never steer a call to another endpoint.
- `mcp-remote` is a third-party bridge fetched by `npx`; the snippet pins a version — review it before bumping.

The in-app chat uses the same tools: see [`assistant.md`](assistant.md).

## Draft-only write tool

A **write-scoped** token is also offered `propose_transactions` (a read-scoped token never sees it). Give the model a
pasted broker email or contract note and it extracts the trades and calls the tool, which creates a **draft import**
(`POST /imports/propose`): **nothing is booked**. The tool result carries `reviewPath` (and `reviewUrl` when
`PUBLIC_WEB_URL` is set) — the model hands you that link and you confirm in the normal import review screen, which
applies every existing gate (account mismatch, inbound-transfer cost basis, cross-source duplicate acknowledgement).

- The tool is annotated `readOnlyHint: false, destructiveHint: false, idempotentHint: true`; every other tool stays
  `readOnlyHint: true`.
- A proposal carries only trade fields (`action`, instrument identifiers, `quantity`, `price`, `fees`, `currency`,
  `executedAt`, …), at most 100 per call. Fields that steer the import — `externalId`, `taxComponents`, `confidence`,
  `attention` — are rejected; the server sets them. Confidence is a fixed 0.5.
- Dedup: the same proposal is the same import (`alreadyExists` / `alreadyConfirmed`); drafts that match something
  already booked are flagged as likely duplicates, and confirm blocks them until acknowledged. A proposal counts as a
  **manual** entry (parser `ai`, source `manual`), never as a document, so it can only ever be a _duplicate_ of a
  committed row from another source, never an _enrichment_ of it.
- Not covered: corporate actions (see [#969](https://github.com/s3ntin3l8/pocket-portfolio-tracker/issues/969)).
