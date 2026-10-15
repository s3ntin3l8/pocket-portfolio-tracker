# AI assistant access (MCP)

Pocket exposes a **read-only** [Model Context Protocol](https://modelcontextprotocol.io) endpoint so an AI
assistant (Claude Code, Claude Desktop, any MCP client) can read and explain your portfolio.

- **Endpoint:** `POST /mcp` on the API (Streamable HTTP, stateless, JSON responses). `GET`/`DELETE` answer 405.
- **Auth:** a normal Bearer credential. For assistants, create a **read-only personal access token** in
  Settings → Data & connections. A read-scoped token may call `/mcp` even though it is a `POST`
  (`config: { scope: "read" }` on the route — see `plugins/auth.ts`); everything a tool does goes back through
  the API in-process and is gated like any other request.
- **Transport security:** the token is a bearer credential — always use an `https://` API address. (TLS normally terminates at the reverse proxy, so the API itself does not enforce it.)
- **Tools:** the 12 tools in `packages/ai-tools` (portfolios, net worth, summary, holdings, transaction search,
  value history, income, contributions, tax, targets/drift, insights, instrument lookup), plus the
  `pocket://glossary` resource and three prompts (`monthly_review`, `tax_year_check`, `rebalancing_plan`).

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

Not yet: OAuth for claude.ai connectors (#923).
