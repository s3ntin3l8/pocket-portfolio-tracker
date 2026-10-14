import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type {
  AssistantConversation,
  AssistantConversationSummary,
  AssistantEvent,
  AssistantStatus,
} from "@portfolio/api-client";
import messages from "../messages/en.json";
import { AssistantButton } from "@/components/assistant/assistant-button";
import { AssistantProvider } from "@/components/assistant/assistant-provider";
import { AssistantHistoryToggle } from "@/components/settings-sections/assistant-history-toggle";

const CONV_ID = "22222222-2222-2222-2222-222222222222";
const A = messages.Assistant;
const S = messages.Settings;

let status: AssistantStatus;
let events: AssistantEvent[];
const sent: { messages: unknown[]; conversationId?: string }[] = [];
let summaries: AssistantConversationSummary[];
const stored: Record<string, AssistantConversation> = {};

const client = {
  getAssistantStatus: vi.fn(async () => status),
  streamAssistantChat: vi.fn(async function* (body: (typeof sent)[number]) {
    sent.push(body);
    for (const e of events) yield e;
  }),
  listAssistantConversations: vi.fn(async () => ({ conversations: summaries })),
  getAssistantConversation: vi.fn(async (id: string) => {
    const c = stored[id];
    if (!c) throw new Error("404");
    return c;
  }),
  deleteAssistantConversation: vi.fn(async (_id: string) => undefined),
  putPreferences: vi.fn(async (_p: unknown) => ({})),
};
vi.mock("@/lib/api", () => ({ useApiClient: () => client }));
const refresh = vi.fn();
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh }) }));

function Shell() {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <AssistantProvider serverScope="all">
        <AssistantButton />
      </AssistantProvider>
    </NextIntlClientProvider>
  );
}
async function openPanel() {
  fireEvent.click(await screen.findByRole("button", { name: A.open }));
  return screen.findByRole("dialog");
}
const ask = (text: string) => {
  fireEvent.change(screen.getByLabelText(A.inputLabel), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: A.send }));
};

beforeEach(() => {
  status = {
    available: true,
    provider: "claude",
    label: "Claude",
    local: false,
    saveHistory: true,
  };
  events = [
    { type: "status", provider: "claude", local: false },
    { type: "message", text: "Doing well." },
    { type: "conversation", id: CONV_ID, saved: true },
    { type: "done", rounds: 1 },
  ];
  sent.length = 0;
  summaries = [
    {
      id: CONV_ID,
      title: "How am I doing?",
      scope: "all",
      updatedAt: "2026-10-01T10:00:00Z",
      messageCount: 2,
    },
  ];
  stored[CONV_ID] = {
    id: CONV_ID,
    title: "How am I doing?",
    scope: "all",
    updatedAt: "2026-10-01T10:00:00Z",
    messages: [
      { role: "user", content: "How am I doing?" },
      { role: "assistant", content: "Doing well." },
    ],
  };
  for (const fn of Object.values(client)) fn.mockClear();
  refresh.mockClear();
});

describe("assistant history in the panel", () => {
  it("carries the conversation id from the stream into the next question", async () => {
    render(<Shell />);
    await openPanel();
    ask("How am I doing?");
    await screen.findByText("Doing well.");
    expect(sent[0]!.conversationId).toBeUndefined();

    ask("And my allocation?");
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]!.conversationId).toBe(CONV_ID);
  });

  it("starts a fresh conversation after New chat", async () => {
    render(<Shell />);
    await openPanel();
    ask("first");
    await screen.findByText("Doing well.");
    fireEvent.click(screen.getByRole("button", { name: A.newChat }));
    ask("second");
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]!.conversationId).toBeUndefined();
  });

  it("offers History only to users who opted in", async () => {
    status = { ...status, saveHistory: false };
    render(<Shell />);
    await openPanel();
    expect(screen.queryByRole("button", { name: A.history })).toBeNull();
  });

  it("lists saved conversations, reopens one and continues it", async () => {
    render(<Shell />);
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: A.history }));
    fireEvent.click(await screen.findByRole("button", { name: "Open: How am I doing?" }));
    expect(await screen.findByText("Doing well.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: A.historyBack })).toBeNull(); // back in the chat

    ask("Follow-up");
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.conversationId).toBe(CONV_ID);
    expect(sent[0]!.messages).toEqual([
      { role: "user", content: "How am I doing?" },
      { role: "assistant", content: "Doing well." },
      { role: "user", content: "Follow-up" },
    ]);
  });

  it("deletes a saved conversation from the list", async () => {
    render(<Shell />);
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: A.history }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete: How am I doing?" }));
    await waitFor(() => expect(client.deleteAssistantConversation).toHaveBeenCalledWith(CONV_ID));
    expect(await screen.findByText(A.historyEmpty)).toBeInTheDocument();
  });

  it("says so when a conversation can't be deleted, and keeps it listed", async () => {
    client.deleteAssistantConversation.mockRejectedValueOnce(new Error("404"));
    render(<Shell />);
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: A.history }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete: How am I doing?" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(A.historyDeleteError);
    expect(screen.getByRole("button", { name: "Open: How am I doing?" })).toBeInTheDocument();
  });

  it("does not refetch the list when the panel re-renders", async () => {
    render(<Shell />);
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: A.history }));
    await screen.findByRole("button", { name: "Open: How am I doing?" });
    expect(client.listAssistantConversations).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText(A.inputLabel), { target: { value: "typing…" } });
    expect(client.listAssistantConversations).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state and a load error", async () => {
    summaries = [];
    const { unmount } = render(<Shell />);
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: A.history }));
    expect(await screen.findByText(A.historyEmpty)).toBeInTheDocument();
    unmount();

    client.listAssistantConversations.mockRejectedValueOnce(new Error("boom"));
    render(<Shell />);
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: A.history }));
    expect(await screen.findByText(A.historyLoadError)).toBeInTheDocument();
  });

  it("reports a conversation that can't be opened", async () => {
    delete stored[CONV_ID];
    render(<Shell />);
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: A.history }));
    fireEvent.click(await screen.findByRole("button", { name: "Open: How am I doing?" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(A.historyOpenError);
  });

  it("tells the user when the stored conversation is full", async () => {
    events = [
      { type: "message", text: "ok" },
      { type: "conversation", id: CONV_ID, saved: false },
      { type: "done", rounds: 1 },
    ];
    render(<Shell />);
    await openPanel();
    ask("q");
    expect(await screen.findByText(A.historyFull)).toBeInTheDocument();
  });
});

describe("AssistantHistoryToggle", () => {
  const renderToggle = (enabled: boolean) =>
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AssistantHistoryToggle enabled={enabled} />
      </NextIntlClientProvider>,
    );

  it("turns history on straight away", async () => {
    renderToggle(false);
    fireEvent.click(screen.getByRole("switch", { name: S.assistantHistoryLabel }));
    await waitFor(() =>
      expect(client.putPreferences).toHaveBeenCalledWith({ assistantSaveHistory: true }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.getByRole("switch")).toBeChecked();
  });

  it("asks before turning history off, since that deletes what is stored", async () => {
    renderToggle(true);
    fireEvent.click(screen.getByRole("switch"));
    expect(client.putPreferences).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(S.assistantHistoryOffBody)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: S.assistantHistoryOffConfirm }));
    await waitFor(() =>
      expect(client.putPreferences).toHaveBeenCalledWith({ assistantSaveHistory: false }),
    );
    await waitFor(() => expect(screen.getByRole("switch")).not.toBeChecked());
  });

  it("keeps the old value and says so when saving fails", async () => {
    client.putPreferences.mockRejectedValueOnce(new Error("boom"));
    renderToggle(false);
    fireEvent.click(screen.getByRole("switch"));
    expect(await screen.findByRole("alert")).toHaveTextContent(S.assistantHistoryError);
    expect(screen.getByRole("switch")).not.toBeChecked();
  });
});
