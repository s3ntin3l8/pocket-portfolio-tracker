import { describe, expect, it } from "vitest";
import {
  ApiError,
  createApiClient,
  parseAssistantStream,
  type AssistantEvent,
} from "../src/index.js";

const enc = new TextEncoder();

/** A body that emits the given byte chunks, one per read. */
function bodyOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]!);
      else controller.close();
    },
  });
}
async function collect(stream: AsyncIterable<AssistantEvent>) {
  const out: AssistantEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}
const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

describe("parseAssistantStream", () => {
  const full =
    frame("status", { provider: "claude", local: false }) +
    ": keepalive\n\n" +
    frame("tool_call", { id: "t1", name: "get_net_worth", input: { period: "1y" } }) +
    frame("tool_result", { id: "t1", name: "get_net_worth", ok: true }) +
    frame("message", { text: "Net worth is €1.234 — ünïcode ✓" }) +
    frame("done", { rounds: 2 });

  const expected: AssistantEvent[] = [
    { type: "status", provider: "claude", local: false },
    { type: "tool_call", id: "t1", name: "get_net_worth", input: { period: "1y" } },
    { type: "tool_result", id: "t1", name: "get_net_worth", ok: true },
    { type: "message", text: "Net worth is €1.234 — ünïcode ✓" },
    { type: "done", rounds: 2 },
  ];

  it("parses a stream delivered in one chunk and skips keep-alive comments", async () => {
    expect(await collect(parseAssistantStream(bodyOf([enc.encode(full)])))).toEqual(expected);
  });

  it("is chunk-boundary agnostic: every 1-, 2- and 7-byte split gives the same events", async () => {
    const bytes = enc.encode(full);
    for (const size of [1, 2, 7]) {
      const chunks: Uint8Array[] = [];
      for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.slice(i, i + size));
      expect(await collect(parseAssistantStream(bodyOf(chunks))), `size ${size}`).toEqual(expected);
    }
  });

  it("handles CRLF framing", async () => {
    const crlf = full.replace(/\n/g, "\r\n");
    expect(await collect(parseAssistantStream(bodyOf([enc.encode(crlf)])))).toEqual(expected);
  });

  it("yields a final frame that lacks the trailing blank line", async () => {
    const events = await collect(
      parseAssistantStream(bodyOf([enc.encode('event: message\ndata: {"text":"tail"}')])),
    );
    expect(events).toEqual([{ type: "message", text: "tail" }]);
  });

  it("ignores unknown event types and malformed JSON without ending the stream", async () => {
    const events = await collect(
      parseAssistantStream(
        bodyOf([
          enc.encode(
            frame("telemetry", { x: 1 }) +
              "event: message\ndata: {not json\n\n" +
              "data: not json at all\n\n" + // no event name and not JSON → dropped, not fatal
              frame("done", { rounds: 1 }),
          ),
        ]),
      ),
    );
    // The unknown event and both unparseable frames are dropped; only `done` survives.
    expect(events).toEqual([{ type: "done", rounds: 1 }]);
  });

  it("joins multi-line data fields", async () => {
    const events = await collect(
      parseAssistantStream(
        bodyOf([enc.encode('event: message\ndata: {"text":\ndata: "two lines"}\n\n')]),
      ),
    );
    expect(events).toEqual([{ type: "message", text: "two lines" }]);
  });

  it("cancels the body when the consumer stops early", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(enc.encode(frame("message", { text: "a" }) + frame("message", { text: "b" })));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const e of parseAssistantStream(body)) {
      expect(e).toEqual({ type: "message", text: "a" });
      break;
    }
    expect(cancelled).toBe(true);
  });
});

describe("parseAssistantStream hardening", () => {
  it("lets the SSE event name win over a `type` key smuggled into the payload", async () => {
    const events = await collect(
      parseAssistantStream(
        bodyOf([enc.encode('event: message\ndata: {"type":"error","text":"hi"}\n\n')]),
      ),
    );
    expect(events).toEqual([{ type: "message", text: "hi" }]);
  });

  it("refuses a frame that never ends instead of buffering it forever", async () => {
    const chunk = enc.encode("data: " + "x".repeat(200_000));
    const body = bodyOf(Array.from({ length: 8 }, () => chunk)); // 1.6M chars, no blank line
    await expect(collect(parseAssistantStream(body))).rejects.toThrow(
      "assistant_stream_frame_too_large",
    );
  });
});

describe("createApiClient assistant methods", () => {
  it("getAssistantStatus reads /assistant/status", async () => {
    const status = { available: true, provider: "ollama", label: "Ollama (local)", local: true };
    let url = "";
    const client = createApiClient({
      baseUrl: "/api/backend",
      fetch: (async (u: string) => {
        url = u;
        return new Response(JSON.stringify(status), {
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch,
    });
    expect(await client.getAssistantStatus()).toEqual(status);
    expect(url).toBe("/api/backend/assistant/status");
  });

  it("streamAssistantChat posts the conversation with the bearer token and yields typed events", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const client = createApiClient({
      baseUrl: "http://api",
      getToken: () => "tok",
      fetch: (async (url: string, init: RequestInit) => {
        captured = { url, init };
        return new Response(
          bodyOf([enc.encode(frame("message", { text: "hi" }) + frame("done", { rounds: 1 }))]),
          {
            headers: { "content-type": "text/event-stream" },
          },
        );
      }) as unknown as typeof fetch,
    });
    const ac = new AbortController();
    const events = await collect(
      client.streamAssistantChat(
        { messages: [{ role: "user", content: "hello" }], scope: "all" },
        { signal: ac.signal },
      ),
    );
    expect(events).toEqual([
      { type: "message", text: "hi" },
      { type: "done", rounds: 1 },
    ]);
    expect(captured!.url).toBe("http://api/assistant/chat");
    expect(captured!.init.method).toBe("POST");
    expect(captured!.init.signal).toBe(ac.signal);
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer tok");
    expect(headers.accept).toBe("text/event-stream");
    expect(JSON.parse(String(captured!.init.body))).toEqual({
      messages: [{ role: "user", content: "hello" }],
      scope: "all",
    });
  });

  it.each([
    [429, '{"error":"assistant_rate_limited"}'],
    [503, '{"error":"chat_not_configured"}'],
    [400, '{"error":"invalid_request"}'],
  ])("throws an ApiError carrying status %i before any event", async (status, body) => {
    const client = createApiClient({
      baseUrl: "http://api",
      fetch: (async () =>
        new Response(body, {
          status,
          headers: { "retry-after": "30" },
        })) as unknown as typeof fetch,
    });
    const err = await collect(
      client.streamAssistantChat({ messages: [{ role: "user", content: "x" }] }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status, body });
  });
});

describe("delta events", () => {
  it("are parsed as a known event type", async () => {
    const events = [];
    for await (const e of parseAssistantStream(
      bodyOf([
        enc.encode(
          'event: delta\ndata: {"text":"Hel"}\n\nevent: message\ndata: {"text":"Hello"}\n\n',
        ),
      ]),
    ))
      events.push(e);
    expect(events).toEqual([
      { type: "delta", text: "Hel" },
      { type: "message", text: "Hello" },
    ]);
  });
});
