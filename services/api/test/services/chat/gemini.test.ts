import { describe, it, expect } from "vitest";
import { GeminiChatProvider, toGeminiSchema } from "../../../src/services/chat/gemini.js";
import {
  ChatProviderError,
  type ChatMessage,
  type ChatRequest,
} from "../../../src/services/chat/types.js";

interface Captured {
  url: string;
  headers: Record<string, string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: Record<string, any>;
}
const enc = new TextEncoder();
const sseRes = (frames: unknown[]) =>
  new Response(
    new ReadableStream({
      start(c) {
        for (const f of frames) c.enqueue(enc.encode(`data: ${JSON.stringify(f)}\r\n\r\n`));
        c.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
const jsonRes = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function make(respond: () => Response, model = "models/gemini-2.5-pro") {
  const calls: Captured[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    });
    return respond();
  }) as unknown as typeof fetch;
  return { p: new GeminiChatProvider("g-key", { model, fetch: impl }), calls };
}

const REQ: ChatRequest = {
  system: "be brief",
  messages: [{ role: "user", content: "net worth?" }],
  tools: [
    {
      name: "get_networth",
      description: "Net worth",
      inputSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { scope: { type: "string" } },
        additionalProperties: false,
      },
    },
  ],
  maxTokens: 500,
};
const cand = (parts: unknown[], finishReason = "STOP") => ({
  candidates: [{ content: { role: "model", parts }, finishReason }],
  usageMetadata: { totalTokenCount: 7 },
});

describe("GeminiChatProvider.complete", () => {
  it("sends the generateContent request: key header, system instruction, sanitized tools", async () => {
    const f = make(() => jsonRes(cand([{ text: "hi" }])));
    const out = await f.p.complete(REQ);
    expect(out).toMatchObject({ text: "hi", toolCalls: [], stop: "end" });
    const c = f.calls[0]!;
    expect(c.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent",
    );
    expect(c.headers["x-goog-api-key"]).toBe("g-key");
    expect(c.body.systemInstruction).toEqual({ parts: [{ text: "be brief" }] });
    expect(c.body.contents).toEqual([{ role: "user", parts: [{ text: "net worth?" }] }]);
    expect(c.body.generationConfig).toEqual({ maxOutputTokens: 500 });
    expect(c.body.tools[0].functionDeclarations).toEqual([
      {
        name: "get_networth",
        description: "Net worth",
        parameters: { type: "object", properties: { scope: { type: "string" } } },
      },
    ]);
  });

  it("sends no parameters for a tool without arguments (Gemini rejects empty object schemas)", async () => {
    const f = make(() => jsonRes(cand([{ text: "x" }])));
    await f.p.complete({
      ...REQ,
      tools: [
        {
          name: "list_portfolios",
          description: "List",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
        },
      ],
    });
    expect(f.calls[0]!.body.tools[0].functionDeclarations).toEqual([
      { name: "list_portfolios", description: "List" },
    ]);
  });

  it("maps function calls, keeps thought signatures for replay, and ids calls it did not id", async () => {
    const parts = [
      { functionCall: { name: "get_networth", args: { scope: "all" } }, thoughtSignature: "sig1" },
      { functionCall: { id: "fc_2", name: "get_networth", args: {} } },
      { text: "pondering", thought: true },
    ];
    const out = await make(() => jsonRes(cand(parts))).p.complete(REQ);
    expect(out.stop).toBe("tool_use");
    expect(out.text).toBe("");
    expect(out.toolCalls).toEqual([
      { id: "gemini_call_0", name: "get_networth", args: { scope: "all" } },
      { id: "fc_2", name: "get_networth", args: {} },
    ]);
    expect(out.providerState).toEqual({ parts });

    // Replay: model parts verbatim, results as functionResponse objects, synthetic ids dropped.
    const history: ChatMessage[] = [
      { role: "user", content: "q" },
      { role: "assistant", text: "", toolCalls: out.toolCalls, providerState: out.providerState },
      {
        role: "tool",
        results: [
          { callId: "gemini_call_0", name: "get_networth", content: '{"v":1}', isError: false },
          { callId: "fc_2", name: "get_networth", content: '{"error":"x"}', isError: true },
          { callId: "z", name: "t", content: "plain text", isError: false },
        ],
      },
    ];
    const f = make(() => jsonRes(cand([{ text: "ok" }])));
    await f.p.complete({ ...REQ, messages: history });
    const contents = f.calls[0]!.body.contents;
    expect(contents[1]).toEqual({ role: "model", parts });
    expect(contents[2].parts).toEqual([
      { functionResponse: { name: "get_networth", response: { result: { v: 1 } } } },
      {
        functionResponse: { name: "get_networth", id: "fc_2", response: { error: { error: "x" } } },
      },
      { functionResponse: { name: "t", id: "z", response: { result: "plain text" } } },
    ]);
  });

  it("rebuilds the model turn from text and calls when there is no provider state", async () => {
    const f = make(() => jsonRes(cand([{ text: "x" }])));
    await f.p.complete({
      ...REQ,
      messages: [
        { role: "user", content: "q" },
        { role: "assistant", text: "Checking.", toolCalls: [{ id: "a", name: "t", args: null }] },
      ],
    });
    expect(f.calls[0]!.body.contents[1]).toEqual({
      role: "model",
      parts: [{ text: "Checking." }, { functionCall: { name: "t", args: {} } }],
    });
  });

  it("maps finish reasons and a blocked prompt", async () => {
    const stop = async (reason: string) =>
      (await make(() => jsonRes(cand([{ text: "x" }], reason))).p.complete(REQ)).stop;
    expect(await stop("MAX_TOKENS")).toBe("max_tokens");
    for (const r of ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "RECITATION"]) {
      expect(await stop(r)).toBe("refusal");
    }
    const blocked = await make(() =>
      jsonRes({ promptFeedback: { blockReason: "SAFETY" } }),
    ).p.complete(REQ);
    expect(blocked.stop).toBe("refusal");
  });

  it("maps failures to codes without leaking upstream detail", async () => {
    await expect(
      make(() => jsonRes({ error: { message: "secret" } }, 429)).p.complete(REQ),
    ).rejects.toMatchObject({
      code: "provider_error",
      status: 429,
    });
    await expect(make(() => jsonRes({ nothing: true })).p.complete(REQ)).rejects.toMatchObject({
      code: "provider_bad_response",
    });
    await expect(make(() => new Response("not json")).p.complete(REQ)).rejects.toBeInstanceOf(
      ChatProviderError,
    );
    await expect(new GeminiChatProvider("", { model: "m" }).complete(REQ)).rejects.toMatchObject({
      code: "provider_not_configured",
    });
    await expect(new GeminiChatProvider("k", { model: "" }).complete(REQ)).rejects.toMatchObject({
      code: "provider_not_configured",
    });
    const down = new GeminiChatProvider("k", {
      model: "m",
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    await expect(down.complete(REQ)).rejects.toMatchObject({ code: "provider_unreachable" });
    const ac = new AbortController();
    ac.abort();
    const aborted = new GeminiChatProvider("k", {
      model: "m",
      fetch: (async () => {
        throw new DOMException("aborted", "AbortError");
      }) as unknown as typeof fetch,
    });
    await expect(aborted.complete({ ...REQ, signal: ac.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

describe("GeminiChatProvider.stream", () => {
  it("requests the SSE endpoint, streams text deltas (not thoughts) and joins the turn", async () => {
    const f = make(() =>
      sseRes(
        [cand([{ text: "Hel" }], ""), cand([{ text: "lo" }, { text: "hmm", thought: true }])].map(
          (c, i) => (i === 0 ? { candidates: [{ content: c.candidates[0]!.content }] } : c),
        ),
      ),
    );
    const deltas: string[] = [];
    const out = await f.p.stream(REQ, (t) => deltas.push(t));
    expect(f.calls[0]!.url).toContain(":streamGenerateContent?alt=sse");
    expect(deltas).toEqual(["Hel", "lo"]);
    expect(out).toMatchObject({ text: "Hello", stop: "end" });
    expect((out.providerState as { parts: unknown[] }).parts).toEqual([
      { text: "Hello" },
      { text: "hmm", thought: true },
    ]);
  });

  it("collects function calls from a streamed turn", async () => {
    const out = await make(() =>
      sseRes([
        cand([
          { functionCall: { name: "get_networth", args: { scope: "all" } }, thoughtSignature: "s" },
        ]),
      ]),
    ).p.stream(REQ, () => {});
    expect(out.stop).toBe("tool_use");
    expect(out.toolCalls).toEqual([
      { id: "gemini_call_0", name: "get_networth", args: { scope: "all" } },
    ]);
  });

  it("fails on a mid-stream error, a cut-off stream and an HTTP error; rethrows aborts", async () => {
    await expect(
      make(() => sseRes([{ error: { message: "secret" } }])).p.stream(REQ, () => {}),
    ).rejects.toMatchObject({ code: "provider_error" });
    await expect(
      make(() => sseRes([{ candidates: [{ content: { parts: [{ text: "part" }] } }] }])).p.stream(
        REQ,
        () => {},
      ),
    ).rejects.toMatchObject({ code: "provider_bad_response" });
    await expect(make(() => sseRes([])).p.stream(REQ, () => {})).rejects.toMatchObject({
      code: "provider_bad_response",
    });
    await expect(make(() => jsonRes({}, 500)).p.stream(REQ, () => {})).rejects.toMatchObject({
      code: "provider_error",
      status: 500,
    });
    const broken = new GeminiChatProvider("k", {
      model: "m",
      fetch: (async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.error(new Error("reset"));
            },
          }),
        )) as unknown as typeof fetch,
    });
    await expect(broken.stream(REQ, () => {})).rejects.toMatchObject({
      code: "provider_unreachable",
    });
  });

  it("treats a blocked prompt as a refusal and skips malformed frames", async () => {
    const out = await make(() => sseRes([{ promptFeedback: { blockReason: "SAFETY" } }])).p.stream(
      REQ,
      () => {},
    );
    expect(out.stop).toBe("refusal");
    const res = new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(
            enc.encode(`data: {bad\n\ndata: ${JSON.stringify(cand([{ text: "ok" }]))}\n\n`),
          );
          c.close();
        },
      }),
    );
    expect((await make(() => res).p.stream(REQ, () => {})).text).toBe("ok");
  });
});

describe("toGeminiSchema", () => {
  it("keeps the supported subset and drops everything else", () => {
    expect(
      toGeminiSchema({
        $schema: "x",
        type: "object",
        additionalProperties: false,
        required: ["a"],
        properties: {
          a: { type: "string", enum: ["x", "y"], description: "d", pattern: "^x", default: "x" },
          b: { type: "array", items: { type: "number", minimum: 0 }, minItems: 1 },
          c: { type: ["string", "null"] },
          d: { anyOf: [{ type: "integer" }, { type: "null" }] },
          e: {},
        },
      }),
    ).toEqual({
      type: "object",
      required: ["a"],
      properties: {
        a: { type: "string", enum: ["x", "y"], description: "d" },
        b: { type: "array", items: { type: "number", minimum: 0 }, minItems: 1 },
        c: { type: "string", nullable: true },
        d: { type: "integer", nullable: true },
        e: {},
      },
    });
    expect(toGeminiSchema(null)).toEqual({});
    expect(toGeminiSchema({ type: "object", required: [] })).toEqual({ type: "object" });
  });
});
