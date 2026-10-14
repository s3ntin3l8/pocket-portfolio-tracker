# In-app assistant (chat)

A chat that answers questions about **your own** portfolio. A model calls the same read-only tools (plus, for a
write-scoped login, the draft-only `propose_transactions` — see [mcp.md](mcp.md#draft-only-write-tool)) the
[MCP endpoint](mcp.md) serves (`packages/ai-tools`), in-process and with your own credentials, so per-user scoping,
redaction (no account numbers/IBANs, no holder names, no memos) and the "model narrates, never computes" rules are
identical. **Nothing is stored unless you opt in**: the conversation lives in the client, and only if you turn on
_Keep assistant conversations_ are the question and answer texts also saved on the server (see
[Conversation history](#conversation-history-opt-in)).

## Endpoints

|                         |                                                                                                                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /assistant/status` | `{ available, provider, label, local, saveHistory }` — `saveHistory` is true when you opted in to history (and the credential may write); `local` is true when the data never leaves your infrastructure (Ollama). Show it before the first message. |
| `POST /assistant/chat`  | Body `{ messages: [{role: "user"\|"assistant", content}], scope?, conversationId? }`; streams Server-Sent Events.                                                                                                                                    |

`scope` has the web's grammar — `all`, `p:<portfolio id>` or `h:<holder id>` — and tells the model what the user is
looking at so it can pass that id to tools instead of listing portfolios first. Ids must be GUIDs.

### Events

| event          | data                                                                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`       | `{ provider, local }`                                                                                                                                                               |
| `tool_call`    | `{ id, name, input }`                                                                                                                                                               |
| `tool_result`  | `{ id, name, ok }`                                                                                                                                                                  |
| `delta`        | `{ text }` — a text fragment of the turn being generated                                                                                                                            |
| `message`      | `{ text }` — the turn's complete text; ends the turn                                                                                                                                |
| `conversation` | `{ id, saved }` — history on only: the stored conversation this turn was added to (sent just before `done`); `saved: false` = the conversation is full and this turn was not stored |
| `error`        | `{ error, status? }` — a short code, never an upstream body                                                                                                                         |
| `done`         | `{ rounds }`                                                                                                                                                                        |

`delta` events are a live preview: the following `message` carries the same turn's full text and replaces them. A
turn cut off by `max_tokens` or a refusal still sends its `message` and then an `error`; its tool calls never run (a
call whose arguments are truncated is refused as `invalid_arguments`). A provider stream that goes quiet for 60 s is
treated as failed (`provider_unreachable`).

Within a turn, all `tool_call` events come first (in call order), then the `tool_result` events in the same order;
pair them by `id`. A tool that throws gets a failed `tool_result` (`tool_failed`), never a missing one.

Error codes: `provider_error` (+ `status`), `provider_unreachable`, `provider_bad_response`, `provider_not_configured`, `refused`, `truncated`,
`too_many_tool_rounds`, `chat_failed`. Before the stream starts: `400 invalid_request`, `401`, `429`,
`503 chat_not_configured`, `429 assistant_rate_limited`.

## Caps

|                   |                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| History           | ≤ 20 messages, ≤ 4000 characters each; must start and end with a user message                                                                                                                                                                                                                                                                |
| Tool rounds       | ≤ 8 per turn (`MAX_TOOL_ROUNDS`)                                                                                                                                                                                                                                                                                                             |
| Model output      | 8000 tokens per model call (`MAX_TOKENS`)                                                                                                                                                                                                                                                                                                    |
| Tool calls        | ≤ 8 run per model turn (extra calls are answered with `too_many_tool_calls`)                                                                                                                                                                                                                                                                 |
| Tool results      | ≤ 24 000 characters each, ≤ 120 000 per request (`result_budget_exceeded` after that)                                                                                                                                                                                                                                                        |
| Rate              | `ASSISTANT_RATE_LIMIT_MAX` turns per **user** per hour (default 30), keyed by user id after authentication — a refreshed login token or a new PAT shares the budget. In-memory per API process. Invalid or unanswerable requests (400/503) don't count; over the cap → `429 assistant_rate_limited` + `Retry-After`. `0` disables chat turns |
| Client disconnect | aborts the in-flight model call, stops waiting for running tools (an in-process API request can't be cancelled; its result is discarded) and ends the loop                                                                                                                                                                                   |

A read-scoped token may chat: the route is declared `config: { scope: "read" }` (a POST that only reads — see
`docs/mcp.md`), which also keeps the write-invalidation hook from flushing the valuation caches on every turn.

## Providers

The chat provider is picked per request:

1. a **pin**: the admin's pin (Admin → Assistant providers), else the `CHAT_PROVIDER` env var. The pinned provider is used **or nothing** — if it is not usable, chat is unavailable (`503`); it never falls through to another provider, so a "keep it local" pin cannot silently start sending data to a cloud provider. A pin ignores the per-provider enabled switch;
2. otherwise the first provider that is **enabled** and ranked highest by priority **and** configured for chat.

Enabled and priority follow the vision parsers' settings until the admin saves chat-specific ones (Admin → Assistant
providers); "Reset to defaults" drops every chat override again. The **model** is the admin's setting, else the
provider's env var, else the adapter default — a model chosen in the admin also satisfies the "model required" gate
for Gemini, OpenRouter and Ollama. The same page shows which provider answers chat right now.

Credentials are the same vendor credentials the vision parsers use (encrypted DB credential, else env; set them on
the vision providers page). Only the models are chat-specific:

| Provider     | Needs                                   | Notes                                                                                                                                                                                                                                                                                                                |
| ------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude`     | `ANTHROPIC_API_KEY`                     | default model `claude-opus-5-5` (`ANTHROPIC_CHAT_MODEL`, `ANTHROPIC_CHAT_EFFORT`); on the first-party API the request opts into server-side refusal fallback                                                                                                                                                         |
| `openrouter` | key + `OPENROUTER_CHAT_MODEL`           | OpenAI-compatible `/chat/completions` with tools. Requests carry `provider.data_collection: "deny"` (only endpoints that do not retain or train on prompts); set `OPENROUTER_ALLOW_DATA_COLLECTION=true` to relax, e.g. for a model with no such endpoint                                                            |
| `ollama`     | `OLLAMA_BASE_URL` + `OLLAMA_CHAT_MODEL` | tool-calling quality depends on the model. `local` is derived from the URL (loopback, private ranges, `.local`/`.internal`, single-label/Docker names), so a remote URL is reported as not local                                                                                                                     |
| `gemini`     | key + `GEMINI_CHAT_MODEL`               | Gemini `generateContent` with function calling, streamed. Opt-in via the model variable: Gemini outranks OpenRouter and Ollama in the default priority, so a Gemini vision key alone never starts sending chat to Google. The model's parts (including thought signatures) are replayed verbatim between tool rounds |

Provider adapters use plain `fetch` (no SDK), like the vision parsers.

## Conversation history (opt-in)

Off by default (**Settings → Investing → Assistant**, `user_preferences.assistantSaveHistory`). When on, each _completed_
turn is appended to a stored conversation so it can be reopened on any device (**History** in the panel):

- **What is stored: text only** — the user's message and the assistant's final answer. Tool calls, tool results and
  provider state are never stored (they can hold derived portfolio figures), and nothing is stored for a turn that
  failed, was stopped or produced no text. Message text is never written to the logs.
- **Who:** per user, scoped to the owner; a **read-only token never stores** (storing is a write), even if you opted
  in. The prompt is still built from the history the client sends — the server never replays stored text on its own,
  so the redaction rules are unchanged.
- **Bounds:** 50 conversations per user (the oldest is dropped when a new one starts), 200 messages per conversation
  (a full conversation stops saving and the stream says `saved: false`), and conversations untouched for 90 days are
  deleted by the daily sweep (the `gc-staged-receipts` job).
- **Deleting:** `DELETE /assistant/conversations/:id` and `DELETE /assistant/conversations` (the panel's trash icon).
  Turning the setting off deletes everything stored, and so does deleting the account.
- `GET /assistant/conversations` lists `{ id, title, scope, updatedAt, messageCount }`;
  `GET /assistant/conversations/:id` returns the messages. An unknown or foreign `conversationId` on a chat request
  just starts a new conversation (the `conversation` event carries the id to use next).

## Privacy

Tool results (derived figures and holding names — never account numbers, IBANs, holder names or transaction memos)
are sent to the selected provider. `GET /assistant/status` exposes `local` so the UI can disclose this. Logs record
the provider, model, token usage and latency — not message or tool content.

## Deploying behind a proxy

The stream sets `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform` and
`X-Accel-Buffering: no`, and sends a `: keepalive` comment every 15 s. Any proxy in front must not buffer or
compress it (nginx: `proxy_buffering off`; Traefik does not buffer by default) and its idle timeout should exceed
the longest model turn (the per-call upstream timeout is 120 s).

## Web UI

Entry points (both hidden unless `GET /assistant/status` reports `available`; if the lookup fails, nothing is shown):

- the **Assistant** button in the top bar (every route);
- **Ask the assistant to explain** in the gain explainer — closes the explainer, opens the panel and sends a seeded
  question. If an answer is already streaming, the question waits for it to finish instead of being dropped.

The panel (`apps/web/src/components/assistant/`):

- **Disclosure first:** the header says which provider the figures are sent to, or that data stays on your own
  server (`status.local`), plus the "explanations only" disclaimer.
- **Conversation lives in memory.** It survives closing and reopening the panel, and is cleared by **New chat** or a
  reload (unless history is on: then **History** reopens it). History is clipped to the API caps (20 messages × 4000 chars) before sending; only text is sent back, never
  tool results.
- **Scope** is read from the URL's `?scope=` at send time (falling back to the scope the layout rendered for), so the
  model is always told what you are looking at _now_.
- **What it looked up:** each tool call shows as a chip (running → done/failed).
- **Stop** aborts the request; the same-origin proxy (`api/backend/[...path]`) forwards the browser's abort signal, so
  the API stops the in-flight model call. A stopped, cut-off (no `done`) or empty answer says so instead of leaving a
  blank bubble.
- **Errors** map to translated messages (`Assistant.errors.*`, EN + ID); a rate limit, an unconfigured server and an
  invalid request each have their own text.

### Rendering model output

Answers are untrusted text and are rendered as Markdown with these rules (`assistant-markdown.tsx`, covered by tests):

- **Images are never rendered** — a Markdown image would make the browser fetch an arbitrary URL as soon as the
  answer appears, a data-exfiltration channel for a prompt-injected model.
- Raw HTML is dropped (`skipHtml`).
- Only `http(s)://` and root-relative links are clickable (`target=_blank`, `rel="noopener noreferrer nofollow"`,
  `referrerpolicy="no-referrer"`); `javascript:`, `data:` and protocol-relative targets render as plain text.

### Streaming through the web tier

The proxy streams the upstream body unbuffered and keeps the API's headers. The API sends
`Cache-Control: no-cache, no-transform`, which stops Next's gzip middleware from buffering the stream — keep that
header if you put another proxy in front. `@portfolio/api-client` exposes `getAssistantStatus()`,
`streamAssistantChat()` (an async generator of typed events) and the reader `parseAssistantStream()`, which is
chunk-boundary agnostic (UTF-8 and CRLF safe), ignores unknown events and caps a single frame at 1 M characters.
