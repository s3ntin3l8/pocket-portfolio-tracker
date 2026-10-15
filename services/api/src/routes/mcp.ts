import type { FastifyInstance, FastifyReply } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createTools, GLOSSARY, isToolError } from "@portfolio/ai-tools";
import { createApiClient, type ApiClient } from "@portfolio/api-client";
import { z } from "zod";
import { injectFetch } from "../lib/inject-fetch.js";

const GLOSSARY_URI = "pocket://glossary";

const jsonRpcError = (message: string, code = -32000) => ({
  jsonrpc: "2.0" as const,
  error: { code, message },
  id: null,
});

/** One server per request (stateless): the tools close over the caller's own client. */
function buildMcpServer(client: ApiClient, write: boolean): McpServer {
  // `instructions` is injected into the model's context by clients; the resource below is
  // the same text for clients that only surface resources on demand.
  const server = new McpServer({ name: "pocket", version: "0.1.0" }, { instructions: GLOSSARY });

  for (const tool of createTools(client, { write })) {
    const readOnly = tool.readOnly !== false;
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        // A write tool only ever creates drafts the user confirms: additive, repeatable (the same
        // content is the same import), never destructive.
        annotations: readOnly
          ? { readOnlyHint: true, openWorldHint: false }
          : {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: false,
            },
      },
      async (args: unknown) => {
        const out = await tool.handler(args);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(out) }],
          ...(isToolError(out) ? { isError: true } : {}),
        };
      },
    );
  }

  server.registerResource(
    "glossary",
    GLOSSARY_URI,
    {
      title: "Pocket glossary",
      description: "Definitions and rules for gains, the cash boundary, at-cost and FX exclusions.",
      mimeType: "text/markdown",
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: GLOSSARY }] }),
  );

  const prompt = (text: string) => ({
    messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
  });
  server.registerPrompt(
    "monthly_review",
    {
      title: "Monthly review",
      description: "Summarise how the portfolio did and what changed.",
    },
    () =>
      prompt(
        "Review my portfolio for the past month. Use get_net_worth (period 1y), get_performance (1m), " +
          "get_income and get_insights. Report net worth, the change over the month, income received, " +
          "the biggest movers and any holdings valued at cost or excluded for a missing FX rate. " +
          "Name the basis of every gain you quote.",
      ),
  );
  server.registerPrompt(
    "tax_year_check",
    {
      title: "Tax-year check",
      description: "Check Freistellungsauftrag usage and realized gains for a tax year.",
      argsSchema: {
        year: z
          .string()
          .regex(/^\d{4}$/)
          .optional(),
      },
    },
    ({ year }) =>
      prompt(
        `Check my tax position${year ? ` for ${year}` : " for the current year"}. Use get_tax_summary ` +
          "and get_portfolio_summary. Report allowance used vs available per holder and depot, " +
          "realized gains, and whether the allocation across depots looks sensible (get_fsa_allocation shows " +
          "the split per depot; explain_tax_concept explains terms like Vorabpauschale). Not tax advice.",
      ),
  );
  server.registerPrompt(
    "rebalancing_plan",
    {
      title: "Rebalancing plan",
      description: "Compare allocation with targets and suggest what to adjust.",
      argsSchema: { dimension: z.enum(["asset_class", "currency", "region", "sector"]).optional() },
    },
    ({ dimension }) =>
      prompt(
        `Compare my allocation with my targets by ${dimension ?? "asset_class"} using get_rebalancing ` +
          "and get_holdings. Show the drift per bucket and describe, without computing new figures " +
          "yourself, which buckets are over or under target. If I mention fresh cash to invest, pass it as " +
          "newCash to get_rebalancing for the buy-only split.",
      ),
  );

  return server;
}

/**
 * Remote MCP endpoint (Streamable HTTP, stateless, JSON responses). Authenticated by the
 * normal auth plugin, so a Bearer personal access token works with Claude Desktop/Code.
 * `scope: "read"` lets a read-scoped PAT use this POST: it is offered read-only tools, and
 * anything a tool calls goes back through the API (via `injectFetch`), where the read-only
 * token gate still applies. A write-scoped credential is also offered the draft-only write
 * tools (`propose_transactions`).
 */
export async function mcpRoute(app: FastifyInstance) {
  app.post(
    "/mcp",
    { preHandler: app.authenticate, config: { scope: "read", oauthResource: true } },
    async (request, reply) => {
      // We write to the raw response ourselves (the transport owns it), so take it over
      // before anything can be sent and carry over the headers Fastify plugins (helmet,
      // cors) already set on the reply.
      reply.hijack();
      for (const [name, value] of Object.entries(reply.getHeaders())) {
        if (value !== undefined) reply.raw.setHeader(name, value);
      }
      // The api-client has no other way to set Authorization: it only sends one when `getToken`
      // returns a token (injectFetch just forwards the headers it is given). Drop this and every
      // inner call is unauthenticated.
      const token = (request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      const client = createApiClient({
        baseUrl: "",
        fetch: injectFetch(app),
        getToken: () => token,
      });
      // Draft-writing tools are offered only to a write-scoped credential (a read-only PAT
      // could never use them: the API refuses its POSTs).
      const server = buildMcpServer(client, request.user?.scope === "write");
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      const closeFailed = (err: unknown) => request.log.warn({ err }, "mcp close failed");
      reply.raw.on("close", () => {
        transport.close().catch(closeFailed);
        server.close().catch(closeFailed);
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(request.raw, reply.raw, request.body);
      } catch (err) {
        request.log.error({ err }, "mcp request failed");
        if (!reply.raw.headersSent) {
          reply.raw.writeHead(500, { "content-type": "application/json" });
          reply.raw.end(JSON.stringify(jsonRpcError("Internal server error", -32603)));
        }
      }
    },
  );

  // Stateless: no server-initiated stream (GET) and no session to terminate (DELETE).
  const notAllowed = async (_req: unknown, reply: FastifyReply) =>
    reply.code(405).header("allow", "POST").send(jsonRpcError("Method not allowed."));
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);
}
