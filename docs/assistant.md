# In-app assistant (chat)

A chat that answers questions about **your own** portfolio. A model calls the same read-only tools the
[MCP endpoint](mcp.md) serves (`packages/ai-tools`), in-process and with your own credentials, so per-user scoping,
redaction (no account numbers/IBANs, no holder names, no memos) and the "model narrates, never computes" rules are
identical. Nothing is stored: the conversation lives in the client.

## Endpoints

|                         |                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /assistant/status` | `{ available, provider, label, local }` — `local` is true when the data never leaves your infrastructure (Ollama). Show it before the first message. |
| `POST /assistant/chat`  | Body `{ messages: [{role: "user"\|"assistant", content}], scope? }`; streams Server-Sent Events.                                                     |

`scope` has the web's grammar — `all`, `p:<portfolio id>` or `h:<holder id>` — and tells the model what the user is
looking at so it can pass that id to tools instead of listing portfolios first. Ids must be GUIDs.

### Events

| event         | data                                                        |
| ------------- | ----------------------------------------------------------- |
| `status`      | `{ provider, local }`                                       |
| `tool_call`   | `{ id, name, input }`                                       |
| `tool_result` | `{ id, name, ok }`                                          |
| `message`     | `{ text }` — one per model turn (**not** per token)         |
| `error`       | `{ error, status? }` — a short code, never an upstream body |
| `done`        | `{ rounds }`                                                |

Error codes: `provider_error` (+ `status`), `provider_unreachable`, `provider_bad_response`, `refused`, `truncated`,
`too_many_tool_rounds`, `chat_failed`. Before the stream starts: `400 invalid_request`, `401`, `429`,
`503 chat_not_configured`.

## Caps

|                   |                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| History           | ≤ 20 messages, ≤ 4000 characters each; must start and end with a user message                           |
| Tool rounds       | ≤ 8 per turn (`MAX_TOOL_ROUNDS`)                                                                        |
| Model output      | 8000 tokens per model call (`MAX_TOKENS`)                                                               |
| Tool result       | 24 000 characters passed back to the model                                                              |
| Rate              | `ASSISTANT_RATE_LIMIT_MAX` turns per credential per hour (default 30), separate from the API-wide limit |
| Client disconnect | aborts the in-flight model call and stops the loop                                                      |

A read-scoped token may chat: the route is declared `config: { scope: "read" }` (a POST that only reads — see
`docs/mcp.md`), which also keeps the write-invalidation hook from flushing the valuation caches on every turn.

## Providers

The chat provider is picked per request:

1. `CHAT_PROVIDER` pin, if that provider is configured for chat;
2. otherwise the first provider that is **enabled** and ranked highest in the admin's provider priority (the same
   enable/priority settings as the vision parsers) **and** configured for chat.

Credentials are the same vendor credentials the vision parsers use (encrypted DB credential, else env). Only the
models are chat-specific:

| Provider     | Needs                                   | Notes                                                                                                                                                        |
| ------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `claude`     | `ANTHROPIC_API_KEY`                     | default model `claude-opus-5-5` (`ANTHROPIC_CHAT_MODEL`, `ANTHROPIC_CHAT_EFFORT`); on the first-party API the request opts into server-side refusal fallback |
| `openrouter` | key + `OPENROUTER_CHAT_MODEL`           | OpenAI-compatible `/chat/completions` with tools                                                                                                             |
| `ollama`     | `OLLAMA_BASE_URL` + `OLLAMA_CHAT_MODEL` | local; tool-calling quality depends on the model                                                                                                             |

Gemini has no chat adapter yet. Provider adapters use plain `fetch` (no SDK), like the vision parsers.

## Privacy

Tool results (derived figures and holding names — never account numbers, IBANs, holder names or transaction memos)
are sent to the selected provider. `GET /assistant/status` exposes `local` so the UI can disclose this. Logs record
the provider, model, token usage and latency — not message or tool content.
