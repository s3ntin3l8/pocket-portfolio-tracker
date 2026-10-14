import { describe, expect, it } from "vitest";
import { ApiError } from "@portfolio/api-client";
import {
  applyEvent,
  displayText,
  settleTurn,
  currentScope,
  errorKey,
  errorKeyFor,
  MAX_HISTORY_MESSAGES,
  MAX_MESSAGE_CHARS,
  toRequestMessages,
  type ChatTurn,
} from "@/lib/assistant-chat";

const turn = (over: Partial<ChatTurn> & Pick<ChatTurn, "role" | "content">): ChatTurn => ({
  id: Math.random().toString(36),
  steps: [],
  ...over,
});
const GUID = "11111111-1111-1111-1111-111111111111";

describe("toRequestMessages", () => {
  it("sends text only, skipping pending and empty assistant turns", () => {
    const out = toRequestMessages([
      turn({ role: "user", content: "hi" }),
      turn({ role: "assistant", content: "", error: "provider_error" }), // failed: no text
      turn({ role: "user", content: "again" }),
      turn({ role: "assistant", content: "partial", pending: true }), // still streaming
    ]);
    expect(out).toEqual([
      { role: "user", content: "hi" },
      { role: "user", content: "again" },
    ]);
  });

  it(`keeps the last ${MAX_HISTORY_MESSAGES} messages and starts on a user message`, () => {
    const turns: ChatTurn[] = [];
    for (let i = 0; i < 15; i++) {
      turns.push(
        turn({ role: "user", content: `q${i}` }),
        turn({ role: "assistant", content: `a${i}` }),
      );
    }
    const out = toRequestMessages(turns);
    expect(out.length).toBeLessThanOrEqual(MAX_HISTORY_MESSAGES);
    expect(out[0]!.role).toBe("user");
    expect(out.at(-1)).toEqual({ role: "assistant", content: "a14" });
  });

  it("clips overlong messages to the API cap", () => {
    const [m] = toRequestMessages([
      turn({ role: "user", content: "x".repeat(MAX_MESSAGE_CHARS + 500) }),
    ]);
    expect(m!.content).toHaveLength(MAX_MESSAGE_CHARS);
  });
});

describe("applyEvent", () => {
  const base = turn({ role: "assistant", content: "" });

  it("joins several model messages as paragraphs", () => {
    const a = applyEvent(base, { type: "message", text: "First." });
    expect(applyEvent(a, { type: "message", text: "Second." }).content).toBe("First.\n\nSecond.");
  });

  it("tracks tool steps from running to done or failed, by id", () => {
    let t = applyEvent(base, { type: "tool_call", id: "a", name: "get_net_worth", input: {} });
    t = applyEvent(t, { type: "tool_call", id: "b", name: "get_holdings", input: {} });
    t = applyEvent(t, { type: "tool_result", id: "b", name: "get_holdings", ok: false });
    t = applyEvent(t, { type: "tool_result", id: "a", name: "get_net_worth", ok: true });
    expect(t.steps).toEqual([
      { id: "a", name: "get_net_worth", status: "done" },
      { id: "b", name: "get_holdings", status: "failed" },
    ]);
  });

  it("maps server error codes to message keys and ignores status/done", () => {
    expect(applyEvent(base, { type: "error", error: "refused" }).error).toBe("refused");
    expect(applyEvent(base, { type: "error", error: "something_new" }).error).toBe("generic");
    expect(applyEvent(base, { type: "done", rounds: 1 })).toBe(base);
    expect(applyEvent(base, { type: "status", provider: "x", local: false })).toBe(base);
  });
});

describe("error keys", () => {
  it("covers every server code and falls back to generic", () => {
    for (const code of [
      "provider_error",
      "truncated",
      "assistant_rate_limited",
      "chat_not_configured",
    ]) {
      expect(errorKey(code)).toBe(code);
    }
    expect(errorKey("nope")).toBe("generic");
  });

  it("maps pre-stream HTTP failures and network errors", () => {
    expect(errorKeyFor(new ApiError(401, "{}"))).toBe("unauthorized");
    expect(errorKeyFor(new ApiError(429, "{}"))).toBe("assistant_rate_limited");
    expect(errorKeyFor(new ApiError(503, "{}"))).toBe("chat_not_configured");
    expect(errorKeyFor(new ApiError(400, "{}"))).toBe("invalid_request");
    expect(errorKeyFor(new ApiError(500, "{}"))).toBe("chat_failed");
    expect(errorKeyFor(new TypeError("fetch failed"))).toBe("network");
  });
});

describe("currentScope", () => {
  it("prefers the URL's ?scope=, in the API's grammar", () => {
    expect(currentScope(`?scope=p:${GUID}`, "all")).toBe(`p:${GUID}`);
    expect(currentScope(`?scope=h:${GUID}&range=1y`, null)).toBe(`h:${GUID}`);
    expect(currentScope("?scope=all", `holder:${GUID}`)).toBe("all");
  });

  it("falls back to the scope the layout rendered for (cookie encoding)", () => {
    expect(currentScope("", GUID)).toBe(`p:${GUID}`);
    expect(currentScope("", `holder:${GUID}`)).toBe(`h:${GUID}`);
    expect(currentScope("", "all")).toBe("all");
    expect(currentScope("", null)).toBe("all");
  });

  it("ignores an invalid URL scope rather than sending it", () => {
    expect(currentScope("?scope=p:../../me", "all")).toBe("all");
  });
});

describe("streaming deltas", () => {
  const base: ChatTurn = { id: "a", role: "assistant", content: "", steps: [], pending: true };

  it("accumulates deltas into a preview that the turn's message replaces", () => {
    let t = applyEvent(base, { type: "delta", text: "Hel" });
    t = applyEvent(t, { type: "delta", text: "lo" });
    expect(t.content).toBe("");
    expect(displayText(t)).toBe("Hello");
    t = applyEvent(t, { type: "message", text: "Hello!" });
    expect(t.streaming).toBeUndefined();
    expect(displayText(t)).toBe("Hello!");
  });

  it("shows earlier messages and the one streaming in as paragraphs", () => {
    const t = applyEvent({ ...base, content: "First." }, { type: "delta", text: "Second" });
    expect(displayText(t)).toBe("First.\n\nSecond");
  });

  it("keeps the partial text of a stopped turn so it counts as history", () => {
    const settled = settleTurn(applyEvent(base, { type: "delta", text: "half an ans" }));
    expect(settled).toMatchObject({ content: "half an ans", streaming: undefined });
    expect(settleTurn(settled)).toBe(settled);
  });
});
