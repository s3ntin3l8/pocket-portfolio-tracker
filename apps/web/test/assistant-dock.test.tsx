import { act, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AssistantEvent, AssistantStatus } from "@portfolio/api-client";
import messages from "../messages/en.json";
import { AssistantButton } from "@/components/assistant/assistant-button";
import {
  AssistantProvider,
  AssistantSlot,
  useAssistant,
} from "@/components/assistant/assistant-provider";

const PORTFOLIO = "22222222-2222-2222-2222-222222222222";

const calls: { messages: { role: string; content: string }[]; scope?: string }[] = [];
let status: AssistantStatus = {
  available: true,
  provider: "claude",
  label: "Claude (Anthropic)",
  local: false,
};
const client = {
  getAssistantStatus: vi.fn(async () => status),
  streamAssistantChat: vi.fn((body: (typeof calls)[number]) => {
    calls.push(body);
    return (async function* (): AsyncGenerator<AssistantEvent> {
      yield { type: "message", text: "ok" };
      yield { type: "done", rounds: 1 };
    })();
  }),
  putPreferences: vi.fn(async () => ({})),
  listAssistantConversations: vi.fn(async () => ({ conversations: [] })),
  getAssistantConversation: vi.fn(async () => null),
  deleteAssistantConversation: vi.fn(async () => undefined),
};
vi.mock("@/lib/api", () => ({ useApiClient: () => client }));

const captured: { current: ReturnType<typeof useAssistant> | null } = { current: null };
function Capture() {
  const assistant = useAssistant();
  useEffect(() => {
    captured.current = assistant;
  });
  return null;
}
const api = {
  open: (...args: Parameters<ReturnType<typeof useAssistant>["open"]>) =>
    captured.current!.open(...args),
};

function Shell() {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <AssistantProvider serverScope="all">
        <AssistantButton />
        <Capture />
        <AssistantSlot />
      </AssistantProvider>
    </NextIntlClientProvider>
  );
}

/** Pretend the viewport is `md:` or wider (or not). */
function setWide(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  calls.length = 0;
  status = { available: true, provider: "claude", label: "Claude (Anthropic)", local: false };
  client.streamAssistantChat.mockClear();
  client.putPreferences.mockClear();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
  setWide(true);
});
afterEach(() => vi.restoreAllMocks());

const openButton = () => screen.findByRole("button", { name: "Open the assistant" });

describe("the desktop dock", () => {
  it("opens as a complementary region, not a modal dialog", async () => {
    render(<Shell />);
    fireEvent.click(await openButton());
    const dock = await screen.findByRole("complementary", { name: "Assistant" });
    expect(dock).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Open the assistant" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // Typing can start right away.
    await waitFor(() => expect(screen.getByLabelText("Message to the assistant")).toHaveFocus());
  });

  it("closes from the header ×, from Escape and from the top-bar button, keeping focus there", async () => {
    render(<Shell />);
    const toggle = await openButton();
    toggle.focus();
    fireEvent.click(toggle);
    await screen.findByRole("complementary", { name: "Assistant" });

    fireEvent.click(screen.getByRole("button", { name: "Close the assistant" }));
    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
    expect(toggle).toHaveFocus();

    toggle.focus();
    fireEvent.click(toggle);
    await screen.findByRole("complementary", { name: "Assistant" });
    // Focus is on the page, not in the dock: the page stays interactive beside it.
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
    expect(toggle).toHaveFocus();

    toggle.focus();
    fireEvent.click(toggle);
    await screen.findByRole("complementary", { name: "Assistant" });
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
    expect(toggle).toHaveFocus();
  });

  it("returns focus to the top-bar button when what opened it has been removed", async () => {
    render(<Shell />);
    const toggle = await openButton();
    // Like a hand-off from a dialog that is animating out: the opener is gone by the time we close.
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    act(() => api.open());
    await screen.findByRole("complementary", { name: "Assistant" });
    opener.remove();
    fireEvent.click(screen.getByRole("button", { name: "Close the assistant" }));
    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
    expect(toggle).toHaveFocus();
  });

  it("remembers the wide size per device", async () => {
    const { unmount } = render(<Shell />);
    fireEvent.click(await openButton());
    const widen = await screen.findByRole("button", { name: "Widen the assistant" });
    expect(widen).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(widen);
    expect(screen.getByRole("button", { name: "Narrow the assistant" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(window.localStorage.getItem("pocket.assistant.wide")).toBe("1");
    unmount();

    render(<Shell />);
    fireEvent.click(await openButton());
    expect(await screen.findByRole("button", { name: "Narrow the assistant" })).toBeInTheDocument();
  });

  it("keeps the draft, the conversation and a turned-on History when the viewport crosses the breakpoint", async () => {
    const { rerender } = render(<Shell />);
    fireEvent.click(await openButton());
    await screen.findByRole("complementary", { name: "Assistant" });
    fireEvent.change(screen.getByLabelText("Message to the assistant"), {
      target: { value: "Where do I stand?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("ok")).toBeInTheDocument();
    // Turn saving on from the panel, then leave a half-typed draft.
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: messages.Assistant.historyEnable }));
    await screen.findByText(messages.Assistant.historyEmpty);
    fireEvent.click(screen.getByRole("button", { name: messages.Assistant.historyBack }));
    fireEvent.change(screen.getByLabelText("Message to the assistant"), {
      target: { value: "half a thought" },
    });

    setWide(false);
    rerender(<Shell />);
    await screen.findByRole("dialog");
    expect(screen.getByLabelText("Message to the assistant")).toHaveValue("half a thought");
    expect(screen.getByText("Where do I stand?")).toBeInTheDocument();
    expect(screen.getByText("ok")).toBeInTheDocument();
    // Saving is still on in the new container: History lists, it does not offer the opt-in again.
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(await screen.findByText(messages.Assistant.historyEmpty)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: messages.Assistant.historyEnable })).toBeNull();
  });
});

describe("hand-off from another screen", () => {
  it("puts the prefill in the composer without sending it", async () => {
    render(<Shell />);
    await openButton();
    act(() => api.open({ prefill: "Record this in Main: ", scope: `p:${PORTFOLIO}` }));
    const input = await screen.findByLabelText("Message to the assistant");
    await waitFor(() => expect(input).toHaveValue("Record this in Main: "));
    expect(calls).toHaveLength(0);
  });

  it("sends the next question with the portfolio scope, and drops it on New chat", async () => {
    render(<Shell />);
    await openButton();
    act(() => api.open({ prefill: "Record this: ", scope: `p:${PORTFOLIO}` }));
    const input = await screen.findByLabelText("Message to the assistant");
    fireEvent.change(input, { target: { value: "Record this: bought 2 VWCE" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.scope).toBe(`p:${PORTFOLIO}`);

    fireEvent.click(await screen.findByRole("button", { name: "New chat" }));
    fireEvent.change(screen.getByLabelText("Message to the assistant"), {
      target: { value: "How is it going?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.scope).toBe("all");
  });

  it("still sends a plain string question straight away", async () => {
    render(<Shell />);
    await openButton();
    act(() => api.open("Explain my gains"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.messages.at(-1)!.content).toBe("Explain my gains");
  });

  it("drops the portfolio pin however the panel is closed, including the top-bar button", async () => {
    render(<Shell />);
    const toggle = await openButton();
    act(() => api.open({ prefill: "Record this: ", scope: `p:${PORTFOLIO}` }));
    await screen.findByRole("complementary", { name: "Assistant" });
    fireEvent.click(toggle); // closes through the provider, not the dock's own ×
    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());

    fireEvent.click(toggle);
    const input = await screen.findByLabelText("Message to the assistant");
    fireEvent.change(input, { target: { value: "What changed?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.scope).toBe("all");
  });

  it("does not let a question from elsewhere inherit a hand-off's portfolio", async () => {
    render(<Shell />);
    await openButton();
    act(() => api.open({ prefill: "Record this: ", scope: `p:${PORTFOLIO}` }));
    await screen.findByRole("complementary", { name: "Assistant" });
    // The dock stays open, so the user can use another entry point meanwhile.
    act(() => api.open("Explain my gain figures"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.scope).toBe("all");
  });

  it("keeps a half-typed draft in front of which the starter text goes", async () => {
    render(<Shell />);
    await openButton();
    act(() => api.open());
    const input = await screen.findByLabelText("Message to the assistant");
    fireEvent.change(input, { target: { value: "bought 2 VWCE" } });
    act(() => api.open({ prefill: "Record this in Main: ", scope: `p:${PORTFOLIO}` }));
    await waitFor(() => expect(input).toHaveValue("Record this in Main: bought 2 VWCE"));
    expect(calls).toHaveLength(0);
  });

  it("leaves Escape to an overlay that is open on top of the dock", async () => {
    render(<Shell />);
    fireEvent.click(await openButton());
    await screen.findByRole("complementary", { name: "Assistant" });
    const overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    document.body.appendChild(overlay);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getByRole("complementary", { name: "Assistant" })).toBeInTheDocument();
    overlay.remove();
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
  });

  it("honours a scope on its own, with nothing to send or prefill", async () => {
    render(<Shell />);
    await openButton();
    act(() => api.open({ scope: `p:${PORTFOLIO}` }));
    const input = await screen.findByLabelText("Message to the assistant");
    fireEvent.change(input, { target: { value: "What is in here?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.scope).toBe(`p:${PORTFOLIO}`);
  });
});
