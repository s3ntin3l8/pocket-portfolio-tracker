import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { createTools, GLOSSARY } from "@portfolio/ai-tools";
import { createApiClient } from "@portfolio/api-client";
import { injectFetch } from "../lib/inject-fetch.js";
import { createWindowLimiter } from "../lib/window-limiter.js";
import {
  deleteAllConversations,
  deleteConversation,
  getConversation,
  isHistoryEnabled,
  listConversations,
  saveTurn,
} from "../services/assistant-history.js";
import { runChat, type ChatEvent } from "../services/chat/loop.js";
import type { ChatMessage } from "../services/chat/types.js";

/** Request caps (cost and abuse bounds). History is client-held, text only. */
export const MAX_HISTORY_MESSAGES = 20;
export const MAX_MESSAGE_CHARS = 4000;
/** Seconds between SSE keep-alive comments, so idle proxies don't cut a slow model turn. */
const KEEPALIVE_MS = 15_000;

const GUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const SCOPE = new RegExp(`^(all|[ph]:${GUID})$`);

const bodySchema = z
  .object({
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().min(1).max(MAX_MESSAGE_CHARS),
        }),
      )
      .min(1)
      .max(MAX_HISTORY_MESSAGES),
    /** Same grammar as the web's `?scope=`: all | p:<portfolio id> | h:<holder id>. */
    scope: z.string().regex(SCOPE).optional(),
    /** Append this turn to a stored conversation (only used when history is on). */
    conversationId: z.string().uuid().optional(),
  })
  .refine((b) => b.messages[0]?.role === "user" && b.messages.at(-1)?.role === "user", {
    message: "conversation must start and end with a user message",
  });

function systemPrompt(scope: string | undefined): string {
  const viewing = !scope
    ? "unknown"
    : scope === "all"
      ? "all portfolios combined"
      : scope.startsWith("p:")
        ? `portfolio ${scope.slice(2)}`
        : `account holder ${scope.slice(2)}`;
  return [
    "You are Pocket's portfolio assistant. You help the user understand their own portfolio, using the tools provided to read their data.",
    "",
    "How to work:",
    "- Use tools to get facts; answer only from tool results. If a tool returns { error }, say what could not be read instead of guessing.",
    "- Be concise. Reply in the language of the user's latest message. Quote amounts with their currency exactly as returned.",
    "- You explain; you do not give financial, tax or legal advice.",
    `- The user is currently viewing: ${viewing}. When that is a portfolio or holder, pass its id to tools rather than calling list_portfolios first.`,
    "",
    GLOSSARY,
  ].join("\n");
}

/**
 * In-app assistant. `POST /assistant/chat` streams Server-Sent Events while a model calls the
 * same read-only tools the MCP endpoint serves (in-process, with the caller's own credentials),
 * so per-user scoping, redaction and rate limits are identical. Nothing is stored unless the
 * user opted in (`assistantSaveHistory`); then only the text of each completed turn is.
 *
 * Events: `status` {provider,local}, `tool_call`, `tool_result`, `delta` {text}, `message` {text}
 * (one per model turn), `conversation` {id,saved} (history on), `error` {error,status?}, `done`
 * {rounds}. Failures are short
 * codes; upstream bodies never reach the client.
 *
 * `scope: "read"` — like /mcp it is a POST that only reads, so a read-scoped token may use it
 * and the write-invalidation hook must not flush the caches for it. The cost cap is per user
 * (`ASSISTANT_RATE_LIMIT_MAX` turns per hour), enforced here after authentication.
 */
export async function assistantRoute(app: FastifyInstance) {
  // Keyed by user id (known only after authentication), so a refreshed access token or a
  // freshly minted PAT shares the same budget.
  const limiter = createWindowLimiter({
    max: app.config.ASSISTANT_RATE_LIMIT_MAX,
    windowMs: 60 * 60 * 1000,
  });

  /** Opt-in is the user's preference; a read-scoped token additionally never persists. */
  const historyOn = async (request: FastifyRequest) =>
    request.user?.scope === "write" && (await isHistoryEnabled(app.db, request.userId));

  app.get("/assistant/status", { preHandler: app.authenticate }, async (request) => {
    const provider = await app.resolveChatProvider();
    return {
      available: provider !== null,
      provider: provider?.name ?? null,
      label: provider?.label ?? null,
      /** True when data never leaves the user's own infrastructure. */
      local: provider?.local ?? false,
      /** Opted in to keeping conversations, and allowed to (a read-only token never writes). */
      saveHistory: await historyOn(request),
    };
  });

  // ─── Stored conversations (only exist for users who opted in) ─────────────
  app.get("/assistant/conversations", { preHandler: app.authenticate }, async (request) => ({
    conversations: await listConversations(app.db, request.userId),
  }));

  app.get(
    "/assistant/conversations/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const conv = z.string().uuid().safeParse(id).success
        ? await getConversation(app.db, request.userId, id)
        : null;
      return conv ?? reply.code(404).send({ error: "not_found" });
    },
  );

  app.delete(
    "/assistant/conversations/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const ok =
        z.string().uuid().safeParse(id).success &&
        (await deleteConversation(app.db, request.userId, id));
      return ok ? reply.code(204).send() : reply.code(404).send({ error: "not_found" });
    },
  );

  app.delete("/assistant/conversations", { preHandler: app.authenticate }, async (request) => ({
    deleted: await deleteAllConversations(app.db, request.userId),
  }));

  app.post(
    "/assistant/chat",
    {
      preHandler: app.authenticate,
      config: { scope: "read" },
    },
    async (request, reply) => {
      const body = bodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_request" });
      const provider = await app.resolveChatProvider();
      if (!provider) return reply.code(503).send({ error: "chat_not_configured" });
      // The in-process tool client authenticates with the caller's own credential. The auth
      // preHandler guarantees one today; refuse rather than run every tool unauthenticated
      // if that is ever loosened.
      const token = (request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      if (!token) return reply.code(401).send({ error: "missing_token" });
      // Resolved before the stream starts (a failure here just means "don't store").
      const persist = await historyOn(request).catch(() => false);
      // Counted only once the request is valid and answerable, so 400/503 don't use budget.
      const allowed = limiter.hit(request.userId);
      if (!allowed.ok) {
        return reply
          .code(429)
          .header("retry-after", String(allowed.retryAfterSec))
          .send({ error: "assistant_rate_limited" });
      }

      // From here on we own the raw response: take it over before anything is written and
      // carry over headers Fastify plugins (helmet, cors) already set.
      reply.hijack();
      const raw = reply.raw;
      for (const [name, value] of Object.entries(reply.getHeaders())) {
        if (value !== undefined) raw.setHeader(name, value);
      }
      raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no", // reverse proxies must not buffer the stream
      });
      const send = (event: string, data: unknown) => {
        if (!raw.writableEnded) raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // Client gone before we finished: stop paying for model calls.
      const abort = new AbortController();
      raw.on("close", () => {
        if (!raw.writableFinished) abort.abort();
      });
      const keepalive = setInterval(() => {
        if (!raw.writableEnded) raw.write(": keepalive\n\n");
      }, KEEPALIVE_MS);

      try {
        send("status", { provider: provider.name, local: provider.local });
        const client = createApiClient({
          baseUrl: "",
          fetch: injectFetch(app),
          getToken: () => token,
        });
        // History is rebuilt from role + text only. Any `toolCalls` / `providerState` a client
        // sends was already stripped by the body schema; keep it that way — a passthrough would
        // let a client forge tool calls or inject provider content blocks.
        const history: ChatMessage[] = body.data.messages.map((m) =>
          m.role === "user"
            ? { role: "user", content: m.content }
            : { role: "assistant", text: m.content, toolCalls: [] },
        );
        // With history on, `done` is held back until the turn has been stored, so the client
        // learns the conversation id before the stream ends.
        const answer: string[] = [];
        let done: ChatEvent | null = null;
        await runChat({
          provider,
          system: systemPrompt(body.data.scope),
          history,
          tools: createTools(client),
          signal: abort.signal,
          log: request.log,
          emit: (e: ChatEvent) => {
            if (e.type === "message") answer.push(e.text);
            if (e.type === "done" && persist) {
              done = e;
              return;
            }
            const { type, ...data } = e;
            send(type, data);
          },
        });
        if (done) {
          const text = answer.join("\n\n").trim();
          const userText = body.data.messages.at(-1)!.content;
          if (text && !abort.signal.aborted) {
            try {
              const turn = await saveTurn(app.db, request.userId, {
                conversationId: body.data.conversationId,
                scope: body.data.scope,
                user: userText,
                assistant: text,
              });
              if (turn) send("conversation", { id: turn.id, saved: turn.saved });
            } catch (err) {
              // Storing is best-effort: the answer was already delivered. Name only, never content.
              request.log.error(
                { err: err instanceof Error ? err.name : "unknown" },
                "assistant history save failed",
              );
            }
          }
          const { type, ...data } = done as ChatEvent;
          send(type, data);
        }
      } catch (err) {
        // Name only: a provider stack/message can echo prompt material, which logs must not hold.
        request.log.error(
          { err: err instanceof Error ? err.name : "unknown" },
          "assistant chat failed",
        );
        send("error", { error: "chat_failed" });
      } finally {
        clearInterval(keepalive);
        raw.end();
      }
    },
  );
}
