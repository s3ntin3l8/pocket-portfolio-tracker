import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/session-token", () => ({
  accessTokenFromCookieHeader: async () => "session-token",
}));

import { POST } from "@/app/api/backend/[...path]/route";

const ctx = (...path: string[]) => ({ params: Promise.resolve({ path }) });

let calls: { url: string; init: RequestInit }[];
beforeEach(() => {
  process.env.API_URL = "http://api:3000";
  calls = [];
});
afterEach(() => vi.unstubAllGlobals());

describe("/api/backend proxy", () => {
  it("passes the browser's abort signal upstream so a cancelled stream stops the API call", async () => {
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("ok");
    });
    const ac = new AbortController();
    const req = new NextRequest("http://web/api/backend/assistant/chat", {
      method: "POST",
      body: JSON.stringify({ messages: [] }),
      headers: { "content-type": "application/json" },
      signal: ac.signal,
    });
    await POST(req, ctx("assistant", "chat"));
    const upstream = calls[0]!;
    expect(upstream.url).toBe("http://api:3000/assistant/chat");
    expect((upstream.init.headers as Headers).get("authorization")).toBe("Bearer session-token");
    const signal = upstream.init.signal!;
    expect(signal.aborted).toBe(false);
    ac.abort();
    expect(signal.aborted).toBe(true);
  });

  it("streams a text/event-stream response through unbuffered, keeping its headers", async () => {
    const enc = new TextEncoder();
    let push!: (s: string) => void;
    let end!: () => void;
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(c) {
        push = (s) => c.enqueue(enc.encode(s));
        end = () => c.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(upstreamBody, {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            "x-accel-buffering": "no",
          },
        }),
    );
    const res = await POST(
      new NextRequest("http://web/api/backend/assistant/chat", { method: "POST", body: "{}" }),
      ctx("assistant", "chat"),
    );
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    expect(res.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(res.headers.get("x-accel-buffering")).toBe("no");

    // The first event reaches the reader while the upstream is still open.
    const reader = res.body!.getReader();
    push("event: status\ndata: {}\n\n");
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("event: status");
    end();
    expect((await reader.read()).done).toBe(true);
  });
});
