import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ApiError } from "@portfolio/api-client";
import type { AssistantEvent, AssistantStatus, GainSummary } from "@portfolio/api-client";
import messages from "../messages/en.json";
import { AssistantButton } from "@/components/assistant/assistant-button";
import { AssistantProvider, useAssistant } from "@/components/assistant/assistant-provider";
import { GainExplainer } from "@/components/gain-explainer";

const GUID = "11111111-1111-1111-1111-111111111111";

/** A stream the test can feed event by event. */
function controllable() {
  const queue: (AssistantEvent | Error | "end")[] = [];
  let wake: (() => void) | null = null;
  const next = () =>
    new Promise<void>((resolve) => {
      if (queue.length > 0) resolve();
      else wake = resolve;
    });
  const push = (item: AssistantEvent | Error | "end") => {
    queue.push(item);
    wake?.();
    wake = null;
  };
  // Like a real fetch body: aborting the request makes the read reject.
  async function* iterator(signal?: AbortSignal): AsyncGenerator<AssistantEvent> {
    const aborted = new Promise<never>((_resolve, reject) => {
      const fail = () => reject(new DOMException("aborted", "AbortError"));
      if (signal?.aborted) fail();
      else signal?.addEventListener("abort", fail, { once: true });
    });
    aborted.catch(() => undefined); // handled via the race below
    for (;;) {
      await Promise.race([next(), aborted]);
      const item = queue.shift()!;
      if (item === "end") return;
      if (item instanceof Error) throw item;
      yield item;
    }
  }
  return { push, iterator };
}

const calls: {
  body: { messages: { role: string; content: string }[]; scope?: string };
  signal?: AbortSignal;
}[] = [];
let streams: ReturnType<typeof controllable>[] = [];
let status: AssistantStatus | Error = {
  available: true,
  provider: "claude",
  label: "Claude (Anthropic)",
  local: false,
};
const client = {
  getAssistantStatus: vi.fn(async () => {
    if (status instanceof Error) throw status;
    return status;
  }),
  streamAssistantChat: vi.fn(
    (body: (typeof calls)[number]["body"], opts?: { signal?: AbortSignal }) => {
      calls.push({ body, signal: opts?.signal });
      const s = streams.shift() ?? controllable();
      return s.iterator(opts?.signal);
    },
  ),
};
vi.mock("@/lib/api", () => ({ useApiClient: () => client }));

function Shell({ children }: { children?: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <AssistantProvider serverScope="all">
        <AssistantButton />
        {children}
      </AssistantProvider>
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  calls.length = 0;
  streams = [];
  client.getAssistantStatus.mockClear();
  client.streamAssistantChat.mockClear();
  status = { available: true, provider: "claude", label: "Claude (Anthropic)", local: false };
  window.history.replaceState({}, "", "/");
});
afterEach(() => vi.restoreAllMocks());

async function openPanel() {
  fireEvent.click(await screen.findByRole("button", { name: "Open the assistant" }));
  return screen.findByRole("dialog");
}
const type = (text: string) => {
  fireEvent.change(screen.getByLabelText("Message to the assistant"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
};

describe("assistant availability", () => {
  it("shows no entry point when the assistant is not configured", async () => {
    status = { available: false, provider: null, label: null, local: false };
    render(<Shell />);
    await waitFor(() => expect(client.getAssistantStatus).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Open the assistant" })).toBeNull();
  });

  it("shows no entry point when the status lookup fails", async () => {
    status = new Error("down");
    render(<Shell />);
    await waitFor(() => expect(client.getAssistantStatus).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Open the assistant" })).toBeNull();
  });
});

describe("the chat panel", () => {
  it("discloses where the data goes — a provider name, or 'stays local'", async () => {
    render(<Shell />);
    const dialog = await openPanel();
    expect(within(dialog).getAllByText(/sent to Claude \(Anthropic\)/).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/not financial, tax or legal advice/)).toBeInTheDocument();
  });

  it("says the data stays on the user's server for a local provider", async () => {
    status = { available: true, provider: "ollama", label: "Ollama (local)", local: true };
    render(<Shell />);
    const dialog = await openPanel();
    expect(within(dialog).getByText(/your data stays on your infrastructure/)).toBeInTheDocument();
  });

  it("streams an answer: tool steps, then markdown, with the scope and history sent", async () => {
    window.history.replaceState({}, "", `/holdings?scope=p:${GUID}`);
    const s = controllable();
    streams.push(s);
    render(<Shell />);
    await openPanel();
    type("What is my net worth?");

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body).toEqual({
      messages: [{ role: "user", content: "What is my net worth?" }],
      scope: `p:${GUID}`,
    });
    expect(screen.getByText("What is my net worth?")).toBeInTheDocument();
    expect(screen.getByText("Thinking…")).toBeInTheDocument();

    s.push({ type: "status", provider: "claude", local: false });
    s.push({ type: "tool_call", id: "t1", name: "get_net_worth", input: {} });
    expect(await screen.findByText("Net worth")).toBeInTheDocument(); // friendly tool label
    s.push({ type: "tool_result", id: "t1", name: "get_net_worth", ok: true });
    s.push({ type: "message", text: "Your net worth is **€1,000**." });
    s.push({ type: "done", rounds: 2 });
    s.push("end");

    expect(await screen.findByText("€1,000")).toBeInTheDocument();
    expect(screen.getByText("€1,000").tagName).toBe("STRONG"); // markdown rendered
    await waitFor(() => expect(screen.queryByRole("button", { name: "Stop" })).toBeNull());
  });

  it("sends the earlier conversation as text on the next question", async () => {
    const first = controllable();
    const second = controllable();
    streams.push(first, second);
    render(<Shell />);
    await openPanel();
    type("Hello");
    first.push({ type: "message", text: "Hi there" });
    first.push("end");
    await screen.findByText("Hi there");
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument());
    type("And now?");
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.body.messages).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
      { role: "user", content: "And now?" },
    ]);
  });

  it("lets the user stop an answer, aborting the request", async () => {
    streams.push(controllable());
    render(<Shell />);
    await openPanel();
    type("Long question");
    const stop = await screen.findByRole("button", { name: "Stop" });
    expect(calls[0]!.signal!.aborted).toBe(false);
    fireEvent.click(stop);
    expect(calls[0]!.signal!.aborted).toBe(true);
  });

  it("shows a translated error for a rate limit before the stream starts", async () => {
    const s = controllable();
    streams.push(s);
    render(<Shell />);
    await openPanel();
    type("hi");
    s.push(new ApiError(429, '{"error":"assistant_rate_limited"}'));
    expect(await screen.findByRole("alert")).toHaveTextContent(/hourly limit/);
  });

  it("shows a translated error event from inside the stream", async () => {
    const s = controllable();
    streams.push(s);
    render(<Shell />);
    await openPanel();
    type("hi");
    s.push({ type: "error", error: "too_many_tool_rounds" });
    s.push("end");
    expect(await screen.findByRole("alert")).toHaveTextContent(/more lookups than allowed/);
  });

  it("answers suggestion chips and keeps the conversation when closed and reopened", async () => {
    const s = controllable();
    streams.push(s);
    render(<Shell />);
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: "How is my portfolio doing?" }));
    s.push({ type: "message", text: "Doing fine." });
    s.push("end");
    await screen.findByText("Doing fine.");

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await openPanel();
    expect(screen.getByText("Doing fine.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /New chat/ }));
    expect(screen.queryByText("Doing fine.")).toBeNull();
  });
});

describe("answer outcomes", () => {
  it("says so when the user stops before anything arrived (no empty bubble)", async () => {
    streams.push(controllable());
    render(<Shell />);
    await openPanel();
    type("hi");
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    expect(await screen.findByText("Stopped.")).toBeInTheDocument();
  });

  it("reports a stream that was cut off without done or an error", async () => {
    const s = controllable();
    streams.push(s);
    render(<Shell />);
    await openPanel();
    type("hi");
    s.push({ type: "message", text: "Half an ans" });
    s.push("end"); // closed with no `done`
    expect(await screen.findByRole("alert")).toHaveTextContent(/connection was interrupted/);
    expect(screen.getByText("Half an ans")).toBeInTheDocument(); // the partial text is kept
  });

  it("reports a finished stream that produced no answer", async () => {
    const s = controllable();
    streams.push(s);
    render(<Shell />);
    await openPanel();
    type("hi");
    s.push({ type: "done", rounds: 1 });
    s.push("end");
    expect(await screen.findByRole("alert")).toHaveTextContent(/didn't return an answer/);
  });

  it("queues an Explain question that arrives while an answer is streaming, instead of dropping it", async () => {
    const running = controllable();
    const explain = controllable();
    streams.push(running, explain);
    const gain: GainSummary = {
      displayCurrency: "EUR",
      boundary: "outside",
      value: "1",
      costOfOpen: "1",
      netContributed: "1",
      unrealized: "0",
      realized: "0",
      income: "0",
    };
    render(
      <Shell>
        <GainExplainer gain={gain} />
      </Shell>,
    );
    await openPanel();
    type("long running question");
    await waitFor(() => expect(calls).toHaveLength(1));

    // Close the panel, then ask the assistant to explain from the gain explainer.
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "How is this gain calculated?" }));
    fireEvent.click(await screen.findByRole("button", { name: /Ask the assistant to explain/ }));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(1); // still waiting for the running answer

    running.push({ type: "message", text: "first answer" });
    running.push({ type: "done", rounds: 1 });
    running.push("end");
    await waitFor(() => expect(calls).toHaveLength(2)); // now it is sent
    expect(calls[1]!.body.messages.at(-1)!.content).toMatch(/Explain my gain figures/);
    explain.push("end");
  });
});

describe("keyboard focus", () => {
  it("puts the cursor in the composer on desktop widths", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q.includes("min-width: 768px"),
      media: q,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
      onchange: null,
    })) as typeof window.matchMedia;
    try {
      render(<Shell />);
      await openPanel();
      await waitFor(() => expect(screen.getByLabelText("Message to the assistant")).toHaveFocus());
    } finally {
      window.matchMedia = original;
    }
  });
});

describe("superseded answers", () => {
  it("ignores a stopped-by-New-chat answer's late events and keeps the new one's Stop working", async () => {
    const first = controllable();
    const second = controllable();
    streams.push(first, second);
    render(<Shell />);
    await openPanel();
    type("first question");
    await waitFor(() => expect(calls).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: /New chat/ })); // while 'first' is streaming
    expect(calls[0]!.signal!.aborted).toBe(true);
    type("second question");
    await waitFor(() => expect(calls).toHaveLength(2));

    // The abandoned stream keeps talking: none of it may appear in the new conversation.
    first.push({ type: "message", text: "STALE ANSWER" });
    first.push("end");
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("STALE ANSWER")).toBeNull();

    // The new answer is still streaming (the old one finishing must not have cleared that).
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(calls[1]!.signal!.aborted).toBe(false);
    second.push({ type: "message", text: "FRESH ANSWER" });
    second.push("end");
    expect(await screen.findByText("FRESH ANSWER")).toBeInTheDocument();
    expect(screen.queryByText("first question")).toBeNull();
  });
});

describe("entry points that ask a question", () => {
  const gain: GainSummary = {
    displayCurrency: "EUR",
    boundary: "outside",
    value: "1000",
    costOfOpen: "800",
    netContributed: "900",
    unrealized: "200",
    realized: "0",
    income: "0",
  };

  it("opens the panel and sends the question when 'Ask the assistant' is used in the gain explainer", async () => {
    const s = controllable();
    streams.push(s);
    render(
      <Shell>
        <GainExplainer gain={gain} />
      </Shell>,
    );
    await screen.findByRole("button", { name: "Open the assistant" });
    fireEvent.click(screen.getByRole("button", { name: "How is this gain calculated?" }));
    fireEvent.click(await screen.findByRole("button", { name: /Ask the assistant to explain/ }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body.messages[0]!.content).toMatch(/Explain my gain figures/);
    s.push("end");
  });

  it("hides the explainer's assistant action when the assistant is unavailable", async () => {
    status = { available: false, provider: null, label: null, local: false };
    render(
      <Shell>
        <GainExplainer gain={gain} />
      </Shell>,
    );
    await waitFor(() => expect(client.getAssistantStatus).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "How is this gain calculated?" }));
    await screen.findByText("How the gain figures are calculated");
    expect(screen.queryByRole("button", { name: /Ask the assistant to explain/ })).toBeNull();
  });

  it("useAssistant() outside a provider is inert", () => {
    function Probe() {
      const a = useAssistant();
      return <span>{a.available ? "yes" : "no"}</span>;
    }
    render(<Probe />);
    expect(screen.getByText("no")).toBeInTheDocument();
  });
  it("an Explain question is not aborted by React StrictMode's simulated unmount (dev)", async () => {
    const s = controllable();
    streams.push(s);
    render(
      <StrictMode>
        <Shell>
          <GainExplainer gain={gain} />
        </Shell>
      </StrictMode>,
    );
    await screen.findByRole("button", { name: "Open the assistant" });
    fireEvent.click(screen.getByRole("button", { name: "How is this gain calculated?" }));
    fireEvent.click(await screen.findByRole("button", { name: /Ask the assistant to explain/ }));
    await waitFor(() => expect(calls).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20)); // let any deferred cleanup run
    expect(calls).toHaveLength(1); // sent exactly once
    expect(calls[0]!.signal!.aborted).toBe(false); // and still alive
    s.push({ type: "message", text: "Here you go." });
    s.push("end");
    expect(await screen.findByText("Here you go.")).toBeInTheDocument();
  });
});
