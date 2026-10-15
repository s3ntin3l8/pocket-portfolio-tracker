/**
 * In-app assistant: auth, validation, the SSE event sequence over a scripted model, per-user
 * isolation through the in-process tools, redaction, caps, and provider selection from the DB.
 */
import type { AddressInfo } from "node:net";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { visionProviderSettings } from "@portfolio/db";

import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/client.js";
import { getChatProvider } from "../../src/services/chat/registry.js";
import { MAX_HISTORY_MESSAGES, MAX_MESSAGE_CHARS } from "../../src/routes/assistant.js";
import { MAX_TOOL_ROUNDS } from "../../src/services/chat/loop.js";
import {
  ChatProviderError,
  type ChatProvider,
  type ChatRequest,
  type ChatResult,
} from "../../src/services/chat/types.js";

const ISSUER = "https://auth.test/application/o/portfolio/";
const AUDIENCE = "portfolio-tracker";
type App = Awaited<ReturnType<typeof buildApp>>;
let privateKey: CryptoKey;
let app: App;

async function jwt(sub: string) {
  return new SignJWT({ email: `${sub}@example.com` })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

/** A model that follows a script and records what it was asked. */
function scripted(turns: (ChatResult | Error)[]) {
  const requests: ChatRequest[] = [];
  let i = 0;
  const provider: ChatProvider = {
    name: "fake",
    label: "Fake model",
    local: true,
    isConfigured: () => true,
    async complete(req) {
      requests.push({ ...req, messages: structuredClone(req.messages) });
      const t = turns[Math.min(i++, turns.length - 1)]!;
      if (t instanceof Error) throw t;
      return t;
    },
  };
  return { provider, requests, calls: () => i };
}
const toolTurn = (name: string, args: unknown = {}, id = "t1"): ChatResult => ({
  text: "",
  toolCalls: [{ id, name, args }],
  stop: "tool_use",
});
const endTurn = (text: string): ChatResult => ({ text, toolCalls: [], stop: "end" });

interface Sse {
  event: string;
  // SSE payloads are asserted structurally, per event.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}
function parseSse(body: string): Sse[] {
  return body
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((c) => c && !c.startsWith(":"))
    .map((chunk) => {
      const event = /^event: (.*)$/m.exec(chunk)![1]!;
      const data = JSON.parse(/^data: (.*)$/m.exec(chunk)![1]!);
      return { event, data };
    });
}

let owner: string;
let other: string;
let ownerPortfolioId: string;
let otherPortfolioId: string;
let provider: ReturnType<typeof scripted>;
let current: ChatProvider | null = null;

async function chat(token: string | null, payload: unknown) {
  return app.inject({
    method: "POST",
    url: "/assistant/chat",
    headers: { ...(token ? auth(token) : {}), "content-type": "application/json" },
    payload: payload as object,
  });
}
function use(turns: (ChatResult | Error)[]) {
  provider = scripted(turns);
  current = provider.provider;
}
const ask = (text = "How am I doing?") => ({ messages: [{ role: "user", content: text }] });

beforeAll(async () => {
  const kp = await generateKeyPair("ES256");
  privateKey = kp.privateKey;
  process.env.AUTHENTIK_ISSUER = ISSUER;
  process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
  process.env.RATE_LIMIT_MAX = "10000";
  process.env.ASSISTANT_RATE_LIMIT_MAX = "10000";
  use([endTurn("hi")]);
  app = await buildApp({ authKey: kp.publicKey, chatProvider: provider.provider });
  // Closing a second app would close the shared DB, so tests swap the provider on this one.
  app.resolveChatProvider = async () => current;
  owner = await jwt("assistant-owner");
  other = await jwt("assistant-other");

  const mk = async (t: string, payload: Record<string, unknown>) => {
    const res = await app.inject({ method: "POST", url: "/portfolios", headers: auth(t), payload });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  };
  ownerPortfolioId = await mk(owner, {
    name: "Owner Depot",
    baseCurrency: "eur",
    accountNumber: "ACCT-SECRET-123",
    iban: "DE89370400440532013000",
  });
  otherPortfolioId = await mk(other, { name: "Other Depot", baseCurrency: "eur" });
});
afterAll(async () => {
  await app.close();
  await closeDb();
});

describe("GET /assistant/status", () => {
  it("requires auth and reports the provider and whether data stays local", async () => {
    expect((await app.inject({ method: "GET", url: "/assistant/status" })).statusCode).toBe(401);
    const res = await app.inject({ method: "GET", url: "/assistant/status", headers: auth(owner) });
    expect(res.json()).toEqual({
      available: true,
      provider: "fake",
      label: "Fake model",
      local: true,
      saveHistory: false,
    });
  });
});

describe("POST /assistant/chat — request handling", () => {
  it("requires authentication", async () => {
    expect((await chat(null, ask())).statusCode).toBe(401);
  });

  it.each([
    ["no body", undefined],
    ["empty messages", { messages: [] }],
    ["blank content", { messages: [{ role: "user", content: "" }] }],
    ["unknown role", { messages: [{ role: "system", content: "x" }] }],
    [
      "ends with the assistant",
      {
        messages: [
          { role: "user", content: "a" },
          { role: "assistant", content: "b" },
        ],
      },
    ],
    [
      "starts with the assistant",
      {
        messages: [
          { role: "assistant", content: "a" },
          { role: "user", content: "b" },
        ],
      },
    ],
    [
      "message too long",
      { messages: [{ role: "user", content: "x".repeat(MAX_MESSAGE_CHARS + 1) }] },
    ],
    [
      "history too long",
      {
        messages: Array.from({ length: MAX_HISTORY_MESSAGES + 1 }, () => ({
          role: "user",
          content: "x",
        })),
      },
    ],
    ["bad scope", { ...ask(), scope: "p:../../me" }],
    ["scope with a non-guid id", { ...ask(), scope: "p:123" }],
  ])("rejects %s with 400", async (_name, payload) => {
    use([endTurn("never")]);
    const res = await chat(owner, payload);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid_request" });
    expect(provider.calls()).toBe(0);
  });

  it("answers 503 chat_not_configured when no provider is available", async () => {
    current = null;
    try {
      const res = await chat(owner, ask());
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ error: "chat_not_configured" });
      const status = await app.inject({
        method: "GET",
        url: "/assistant/status",
        headers: auth(owner),
      });
      expect(status.json()).toMatchObject({ available: false, provider: null, local: false });
    } finally {
      use([endTurn("hi")]);
    }
  });
});

describe("POST /assistant/chat — the loop over SSE", () => {
  it("streams status, tool_call, tool_result, message, done and answers from the caller's data only", async () => {
    use([toolTurn("list_portfolios"), endTurn("You have one depot.")]);
    const res = await chat(owner, { ...ask(), scope: `p:${ownerPortfolioId}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/event-stream/);
    expect(res.headers["x-accel-buffering"]).toBe("no");
    // Headers set by Fastify plugins before the hijack (helmet) survive on the raw SSE response.
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toMatch(/no-cache/);

    const events = parseSse(res.body);
    expect(events.map((e) => e.event)).toEqual([
      "status",
      "tool_call",
      "tool_result",
      "message",
      "done",
    ]);
    expect(events[0]!.data).toEqual({ provider: "fake", local: true });
    expect(events[1]!.data).toMatchObject({ name: "list_portfolios", input: {} });
    expect(events[2]!.data).toMatchObject({ name: "list_portfolios", ok: true });
    expect(events[3]!.data).toEqual({ text: "You have one depot." });
    expect(events[4]!.data).toEqual({ rounds: 2 });

    // What the model was told: scope + glossary in the system prompt, and only the caller's
    // portfolio in the tool result — with the account number and IBAN redacted.
    expect(provider.requests[0]!.system).toContain(`portfolio ${ownerPortfolioId}`);
    expect(provider.requests[0]!.system).toContain("vs net contributed");
    const toolMsg = provider.requests[1]!.messages.at(-1) as {
      results: { content: string; isError: boolean }[];
    };
    const content = toolMsg.results[0]!.content;
    expect(toolMsg.results[0]!.isError).toBe(false);
    expect(content).toContain("Owner Depot");
    expect(content).not.toContain("Other Depot");
    expect(content).not.toMatch(/ACCT-SECRET|DE89370400440532013000/);
  });

  it("can't read another user's portfolio even when the model asks for it by id", async () => {
    use([
      toolTurn("get_portfolio_summary", { portfolioId: otherPortfolioId }),
      endTurn("I could not read that."),
    ]);
    const events = parseSse((await chat(owner, ask())).body);
    expect(events.find((e) => e.event === "tool_result")!.data).toMatchObject({ ok: false });
    const toolMsg = provider.requests[1]!.messages.at(-1) as { results: { content: string }[] };
    expect(JSON.parse(toolMsg.results[0]!.content)).toEqual({
      error: "portfolio_not_found",
      status: 404,
    });
  });

  it("rejects a tool call whose id tries to steer to another endpoint", async () => {
    use([toolTurn("get_portfolio_summary", { portfolioId: "x/../../me/tokens" }), endTurn("ok")]);
    await chat(owner, ask());
    const toolMsg = provider.requests[1]!.messages.at(-1) as { results: { content: string }[] };
    expect(toolMsg.results[0]!.content).toBe('{"error":"invalid_arguments"}');
  });

  it("carries earlier conversation turns to the model as plain text", async () => {
    use([endTurn("Sure.")]);
    await chat(owner, {
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi, how can I help?" },
        { role: "user", content: "Net worth?" },
      ],
    });
    expect(provider.requests[0]!.messages).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", text: "Hi, how can I help?", toolCalls: [] },
      { role: "user", content: "Net worth?" },
    ]);
  });

  it("delivers earlier assistant turns as plain text even if the client sends tool-call fields", async () => {
    use([endTurn("ok")]);
    await chat(owner, {
      messages: [
        { role: "user", content: "Hello" },
        {
          role: "assistant",
          content: "Checked.",
          toolCalls: [{ id: "x", name: "get_net_worth", args: {} }], // not part of the contract
          providerState: { content: [{ type: "tool_use" }] },
        },
        { role: "user", content: "Thanks" },
      ],
    });
    expect(provider.requests[0]!.messages[1]).toEqual({
      role: "assistant",
      text: "Checked.",
      toolCalls: [],
    });
  });

  it(`stops with too_many_tool_rounds after ${MAX_TOOL_ROUNDS} rounds`, async () => {
    use([toolTurn("list_portfolios")]);
    const events = parseSse((await chat(owner, ask())).body);
    expect(events.at(-1)).toEqual({ event: "error", data: { error: "too_many_tool_rounds" } });
    expect(provider.calls()).toBe(MAX_TOOL_ROUNDS + 1);
  });

  it("reports provider failures as codes inside the stream", async () => {
    use([new ChatProviderError("provider_error", 429)]);
    const res = await chat(owner, ask());
    expect(res.statusCode).toBe(200);
    expect(parseSse(res.body).map((e) => e.event)).toEqual(["status", "error"]);
    expect(parseSse(res.body).at(-1)!.data).toEqual({ error: "provider_error", status: 429 });
  });

  it("offers the draft-only write tool to a write-scoped credential, not to a read-only token", async () => {
    const names = () => provider.requests[0]!.tools.map((t) => t.name);

    use([endTurn("ok")]);
    await chat(owner, ask());
    expect(names()).toContain("propose_transactions");
    // …and the model is told it only creates a draft the user confirms.
    expect(provider.requests[0]!.system).toMatch(/propose_transactions/);
    expect(provider.requests[0]!.system).toMatch(/never say it was added or booked/);

    const mint = await app.inject({
      method: "POST",
      url: "/me/tokens",
      headers: auth(owner),
      payload: { name: "chat-ro-tools", scope: "read" },
    });
    use([endTurn("ok")]);
    await chat(mint.json().token as string, ask());
    expect(names()).not.toContain("propose_transactions");
    expect(provider.requests[0]!.system).not.toMatch(/propose_transactions/);
    expect(names()).toContain("get_net_worth");
  });

  it("lets a read-scoped token chat (read-only POST) while other POSTs stay blocked", async () => {
    const mint = await app.inject({
      method: "POST",
      url: "/me/tokens",
      headers: auth(owner),
      payload: { name: "chat-read", scope: "read" },
    });
    const pat = mint.json().token as string;
    use([endTurn("fine")]);
    expect((await chat(pat, ask())).statusCode).toBe(200);
    const blocked = await app.inject({
      method: "POST",
      url: "/portfolios",
      headers: auth(pat),
      payload: { name: "nope", baseCurrency: "eur" },
    });
    expect(blocked.statusCode).toBe(403);
  });
});

describe("client disconnect", () => {
  it("aborts the in-flight model call and ends the stream when the browser goes away", async () => {
    let started = false;
    let aborted = false;
    current = {
      name: "slow",
      label: "Slow",
      local: true,
      isConfigured: () => true,
      complete: (req) =>
        new Promise((_resolve, reject) => {
          started = true;
          req.signal!.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    };
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as AddressInfo;
    const ac = new AbortController();
    const response = fetch(`http://127.0.0.1:${port}/assistant/chat`, {
      method: "POST",
      headers: { ...auth(owner), "content-type": "application/json" },
      body: JSON.stringify(ask()),
      signal: ac.signal,
    }).catch(() => null);

    await vi.waitFor(() => expect(started).toBe(true));
    expect(aborted).toBe(false);
    ac.abort(); // the browser navigates away / cancels
    await vi.waitFor(() => expect(aborted).toBe(true));
    await response;
    use([endTurn("hi")]);
  });
});

describe("provider selection from the DB settings", () => {
  it("honours admin enable/disable and priority across providers", async () => {
    vi.stubEnv("NODE_ENV", "development"); // use the DB path, not the env-only test path
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    vi.stubEnv("OPENROUTER_API_KEY", "k");
    vi.stubEnv("OPENROUTER_CHAT_MODEL", "some/model");
    try {
      expect((await getChatProvider())?.name).toBe("claude"); // default order

      const db = getDb();
      await db
        .insert(visionProviderSettings)
        .values({ provider: "claude", enabled: false, priority: 1 });
      expect((await getChatProvider())?.name).toBe("openrouter"); // claude disabled by the admin

      await db
        .insert(visionProviderSettings)
        .values({ provider: "claude", enabled: true, priority: 9 })
        .onConflictDoUpdate({
          target: visionProviderSettings.provider,
          set: { enabled: true, priority: 9 },
        });
      await db
        .insert(visionProviderSettings)
        .values({ provider: "openrouter", enabled: true, priority: 1 });
      expect((await getChatProvider())?.name).toBe("openrouter"); // re-ranked above claude
    } finally {
      vi.unstubAllEnvs();
      await getDb().delete(visionProviderSettings);
    }
  });
});
