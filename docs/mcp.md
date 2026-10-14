# AI assistant access (MCP)

Pocket exposes a **read-only** [Model Context Protocol](https://modelcontextprotocol.io) endpoint so an AI
assistant (Claude Code, Claude Desktop, any MCP client) can read and explain your portfolio.

- **Endpoint:** `POST /mcp` on the API (Streamable HTTP, stateless, JSON responses). `GET`/`DELETE` answer 405.
- **Auth:** a normal Bearer credential. For assistants, create a **read-only personal access token** in
  Settings → Data & connections. A read-scoped token may call `/mcp` even though it is a `POST`
  (`config: { scope: "read" }` on the route — see `plugins/auth.ts`); everything a tool does goes back through
  the API in-process and is gated like any other request.
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

Not yet: OAuth for claude.ai connectors (#923), draft-only write tools (#924).
