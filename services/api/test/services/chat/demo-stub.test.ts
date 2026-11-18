import { describe, it, expect } from "vitest";
import { z } from "zod";
import type { AiTool } from "@portfolio/ai-tools";
import { runChat, type ChatEvent } from "../../../src/services/chat/loop.js";
import {
  HOLD_QUESTION,
  OVERVIEW_QUESTION,
  STUB_ANSWER,
  STUB_THINKING_NOTE,
  createDemoChatProvider,
  demoChatProviderFromEnv,
} from "../../../src/services/chat/demo-stub.js";

const netWorth: AiTool = {
  name: "get_net_worth",
  title: "Net worth",
  description: "Net worth",
  inputSchema: z.object({}),
  handler: async () => ({ ok: true }),
};

async function ask(question: string, signal?: AbortSignal) {
  const events: ChatEvent[] = [];
  await runChat({
    provider: createDemoChatProvider(),
    system: "",
    history: [{ role: "user", content: question }],
    tools: [netWorth],
    emit: (e) => events.push(e),
    signal,
  });
  return events;
}

describe("demo chat stub", () => {
  it("answers the overview question with a note, one tool call and a fixed answer", async () => {
    const events = await ask(OVERVIEW_QUESTION);
    expect(events.map((e) => e.type)).toEqual([
      "thinking",
      "tool_call",
      "tool_result",
      "delta",
      "message",
      "done",
    ]);
    expect(events[0]).toEqual({ type: "thinking", text: STUB_THINKING_NOTE });
    expect(events.find((e) => e.type === "message")).toEqual({
      type: "message",
      text: STUB_ANSWER,
    });
  });

  it("answers anything else with the fixed text", async () => {
    const events = await ask("Is my allocation close to my targets?");
    expect(events.map((e) => e.type)).toEqual(["delta", "message", "done"]);
  });

  it("is deterministic: the same question gives the same events", async () => {
    expect(await ask(OVERVIEW_QUESTION)).toEqual(await ask(OVERVIEW_QUESTION));
  });

  it("holds after the progress note until the client aborts, and never answers", async () => {
    const controller = new AbortController();
    const events: ChatEvent[] = [];
    const finished = runChat({
      provider: createDemoChatProvider(),
      system: "",
      history: [{ role: "user", content: HOLD_QUESTION }],
      tools: [netWorth],
      emit: (e) => events.push(e),
      signal: controller.signal,
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(events).toEqual([{ type: "thinking", text: STUB_THINKING_NOTE }]);
    controller.abort();
    await finished; // released by the abort
    expect(events.map((e) => e.type)).toEqual(["thinking"]);
  });
});

describe("demoChatProviderFromEnv", () => {
  it("is off unless the flag is set", () => {
    expect(demoChatProviderFromEnv({ DATABASE_URL: "pglite://x" })).toBeNull();
    expect(demoChatProviderFromEnv({ DEMO_CHAT_STUB: "0", DATABASE_URL: "pglite://x" })).toBeNull();
    expect(demoChatProviderFromEnv({})).toBeNull();
  });

  it("is on with the flag and an embedded database", () => {
    const provider = demoChatProviderFromEnv({ DEMO_CHAT_STUB: "1", DATABASE_URL: "pglite://x" });
    expect(provider?.label).toBe("Demo");
    expect(provider?.isConfigured()).toBe(true);
  });

  it("refuses to start against a real database", () => {
    expect(() =>
      demoChatProviderFromEnv({ DEMO_CHAT_STUB: "1", DATABASE_URL: "postgres://db/prod" }),
    ).toThrow(/pglite/);
    expect(() => demoChatProviderFromEnv({ DEMO_CHAT_STUB: "1" })).toThrow(/pglite/);
  });
});
