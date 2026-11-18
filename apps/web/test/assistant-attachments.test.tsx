import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ApiError } from "@portfolio/api-client";
import type {
  AssistantAttachmentCapability,
  AssistantConversation,
  AssistantEvent,
  AssistantStatus,
} from "@portfolio/api-client";
import messages from "../messages/en.json";
import { AssistantButton } from "@/components/assistant/assistant-button";
import { AssistantProvider } from "@/components/assistant/assistant-provider";
import { AssistantAttachmentsToggle } from "@/components/settings-sections/assistant-attachments-toggle";
import { useAssistantChat } from "@/lib/use-assistant-chat";
import { acceptedAttachmentTypes, readAttachment } from "@/lib/read-attachment";

const A = messages.Assistant;
const S = messages.Settings;

let status: AssistantStatus;
type Sent = {
  messages: {
    role: string;
    content: string;
    attachments?: { name: string; mediaType: string; data: string }[];
  }[];
};
const sent: Sent[] = [];
const events: AssistantEvent[] = [
  { type: "message", text: "Drafted." },
  { type: "done", rounds: 1 } as AssistantEvent,
];

const client = {
  getAssistantStatus: vi.fn(async () => status),
  streamAssistantChat: vi.fn(async function* (body: Sent) {
    sent.push(structuredClone(body));
    for (const e of events) yield e;
  }),
  putPreferences: vi.fn(async (_p: unknown) => ({})),
};
vi.mock("@/lib/api", () => ({ useApiClient: () => client }));
const refresh = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh }),
  // The panel's "allow attachments" hint links to Settings.
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const capability = (over: Partial<AssistantAttachmentCapability> = {}) => ({
  enabled: true,
  optedIn: true,
  images: "yes" as const,
  pdf: true,
  ...over,
});
const baseStatus = (
  attachments?: AssistantAttachmentCapability,
  local = false,
): AssistantStatus => ({
  available: true,
  provider: "claude",
  label: "Claude (Anthropic)",
  local,
  ...(attachments ? { attachments } : {}),
});

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
async function openPanel() {
  fireEvent.click(await screen.findByRole("button", { name: A.open }));
  return screen.findByRole("dialog");
}
const ask = (text: string) => {
  fireEvent.change(screen.getByLabelText(A.inputLabel), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: A.send }));
};
const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')!;
const pick = (...files: File[]) => fireEvent.change(fileInput(), { target: { files } });
const png = (name = "stmt.png") =>
  new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
const pdf = (name = "stmt.pdf") =>
  new File([new Uint8Array([37, 80, 68, 70])], name, { type: "application/pdf" });

beforeEach(() => {
  sent.length = 0;
  status = baseStatus(capability());
  client.getAssistantStatus.mockClear();
  client.streamAssistantChat.mockClear();
  client.putPreferences.mockClear();
  refresh.mockClear();
  window.history.replaceState({}, "", "/");
});

describe("the attach control", () => {
  it("is absent by default (no capability, or not opted in)", async () => {
    status = baseStatus();
    render(<Shell />);
    await openPanel();
    expect(screen.queryByRole("button", { name: A.attach })).toBeNull();
    expect(fileInput()).toBeNull();
  });

  it("is absent when the preference is off, and points at the setting when the model could read a document", async () => {
    status = baseStatus(capability({ enabled: false, optedIn: false }));
    render(<Shell />);
    await openPanel();
    expect(screen.queryByRole("button", { name: A.attach })).toBeNull();
    const link = screen.getByRole("link", { name: "Allow attachments in Settings" });
    expect(link).toHaveAttribute("href", "/settings/investing");
  });

  it("offers no setting hint when the model can't read images", async () => {
    status = baseStatus(capability({ enabled: false, optedIn: false, images: "no" }));
    render(<Shell />);
    await openPanel();
    expect(screen.queryByRole("link", { name: /attachments/i })).toBeNull();
  });

  it("does not tell an opted-in session without write access to turn the setting on", async () => {
    // A read-only token: the preference is already on, so Settings can't fix it.
    status = baseStatus(capability({ enabled: false, optedIn: true }));
    render(<Shell />);
    await openPanel();
    expect(screen.queryByRole("button", { name: A.attach })).toBeNull();
    expect(screen.queryByRole("link", { name: /attachments/i })).toBeNull();
  });

  it("shows a paperclip when enabled, and the disclosure says documents go unredacted", async () => {
    render(<Shell />);
    await openPanel();
    expect(screen.getByRole("button", { name: A.attach })).toBeEnabled();
    expect(
      screen.getByText(A.disclosureCloudAttachments.replaceAll("{provider}", "Claude (Anthropic)")),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Answers use your portfolio figures.*never shared\.$/)).toBeNull();
  });

  it("uses the local wording for a provider on the user's own server", async () => {
    status = baseStatus(capability(), true);
    render(<Shell />);
    await openPanel();
    expect(screen.getByText(A.disclosureLocalAttachments)).toBeInTheDocument();
  });

  it("limits the picker to what the model reads", async () => {
    status = baseStatus(capability({ images: "no", pdf: false }));
    render(<Shell />);
    await openPanel();
    expect(fileInput().accept).toBe("application/pdf");
    expect(acceptedAttachmentTypes(capability())).toEqual([
      "image/png",
      "image/jpeg",
      "image/webp",
      "application/pdf",
    ]);
  });
});

describe("attaching and sending", () => {
  it("shows chips with a remove button, and the one-line warning on the first attach only", async () => {
    render(<Shell />);
    await openPanel();
    pick(png("one.png"));
    const files = await screen.findByRole("list", { name: A.attachedFiles });
    expect(within(files).getByText("one.png")).toBeInTheDocument();
    expect(
      screen.getByText(A.attachWarning.replaceAll("{provider}", "Claude (Anthropic)")),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove one.png" }));
    expect(screen.queryByRole("list", { name: A.attachedFiles })).toBeNull();

    // A second attach in the same session doesn't warn again.
    pick(png("two.png"));
    await screen.findByText("two.png");
    expect(screen.queryByText(/sent to Claude \(Anthropic\) unredacted/)).toBeNull();
  });

  it("sends base64 attachments with the turn, names them in the bubble, and clears the composer", async () => {
    render(<Shell />);
    await openPanel();
    pick(png("stmt.png"), pdf("note.pdf"));
    await screen.findByText("note.pdf");
    ask("Record this trade");

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.messages).toEqual([
      {
        role: "user",
        content: "Record this trade",
        attachments: [
          { name: "stmt.png", mediaType: "image/png", data: "AQID" },
          { name: "note.pdf", mediaType: "application/pdf", data: "JVBERg==" },
        ],
      },
    ]);
    const bubble = await screen.findByRole("list", { name: A.attachedFiles });
    expect(within(bubble).getByText("stmt.png")).toBeInTheDocument();
    // The composer chips are gone (the only list left is the bubble's).
    expect(screen.getAllByRole("list", { name: A.attachedFiles })).toHaveLength(1);
    await screen.findByText("Drafted.");
  });

  it("resends the document with a follow-up, and drops it on New chat", async () => {
    render(<Shell />);
    await openPanel();
    pick(png());
    await screen.findByText("stmt.png");
    ask("Record this");
    await screen.findByText("Drafted.");

    ask("What was the price?");
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]!.messages[0]!.attachments).toHaveLength(1);
    expect(sent[1]!.messages.at(-1)!.attachments).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: A.newChat }));
    ask("Fresh start");
    await waitFor(() => expect(sent).toHaveLength(3));
    expect(sent[2]!.messages).toEqual([{ role: "user", content: "Fresh start" }]);
  });

  it("gives the files and the text back when the API refuses the documents", async () => {
    client.streamAssistantChat.mockImplementationOnce(async function* (body: Sent) {
      sent.push(structuredClone(body));
      throw new ApiError(400, '{"error":"attachment_unsupported"}');
    });
    render(<Shell />);
    await openPanel();
    pick(png("stmt.png"));
    await screen.findByText("stmt.png");
    ask("Record this trade");

    // The refusal is shown, the chip is back to retry or remove, and the text is restored.
    expect(await screen.findByRole("alert")).toHaveTextContent(A.errors.attachment_unsupported);
    expect(await screen.findByRole("button", { name: "Remove stmt.png" })).toBeInTheDocument();
    expect(screen.getByLabelText(A.inputLabel)).toHaveValue("Record this trade");
    // The failed turn no longer lists the file as sent, and the retry sends it again.
    expect(screen.queryByRole("list", { name: A.attachedFiles })?.textContent).toContain(
      "stmt.png",
    );
    fireEvent.click(screen.getByRole("button", { name: A.send }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]!.messages.at(-1)!.attachments).toHaveLength(1);
  });

  it("refuses a wrong type, an oversize file, and more than 3 files", async () => {
    render(<Shell />);
    await openPanel();

    pick(new File(["x"], "evil.exe", { type: "application/x-msdownload" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(A.attachErrors.type);

    const big = png("big.png");
    Object.defineProperty(big, "size", { value: 5 * 1024 * 1024 + 1 });
    pick(big);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(A.attachErrors.size));

    pick(png("1.png"), png("2.png"), png("3.png"), png("4.png"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(A.attachErrors.count));
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(3);
    expect(screen.getByRole("button", { name: A.attach })).toBeDisabled();
  });
});

describe("a conversation reopened from History", () => {
  it("shows the file names and says the file must be attached again", async () => {
    const stored: AssistantConversation = {
      id: "33333333-3333-3333-3333-333333333333",
      title: "t",
      scope: null,
      updatedAt: "2026-01-01T00:00:00Z",
      messages: [
        { role: "user", content: "Record this\n📎 stmt.pdf" },
        { role: "assistant", content: "What is the price?" },
      ],
    };
    const { result } = renderHook(() =>
      useAssistantChat(
        {
          streamAssistantChat: client.streamAssistantChat as never,
          listAssistantConversations: async () => ({ conversations: [] }),
          getAssistantConversation: async () => stored,
        },
        () => "all",
      ),
    );
    await act(async () => {
      await result.current.history!.open(stored.id);
    });
    expect(result.current.turns[0]).toMatchObject({
      content: "Record this",
      attachments: [{ name: "stmt.pdf", reattach: true }],
    });

    // The next question carries no file: it was never stored.
    act(() => void result.current.send("It is 10 EUR"));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.messages.every((m) => m.attachments === undefined)).toBe(true);
  });
});

describe("the per-conversation file count", () => {
  it("counts only files the next request still carries (older turns fall out of the window)", async () => {
    const { result } = renderHook(() =>
      useAssistantChat({ streamAssistantChat: client.streamAssistantChat as never }, () => "all"),
    );
    const file = { name: "s.png", mediaType: "image/png" as const, data: "AQID" };
    const turn = async (text: string, files?: (typeof file)[]) => {
      act(() => void result.current.send(text, files));
      await waitFor(() => expect(result.current.streaming).toBe(false));
    };
    await turn("first", [file]);
    expect(result.current.sentFiles).toBe(1);
    // 20 messages are sent: 10 more exchanges push the first turn out of the window.
    for (let i = 0; i < 10; i++) await turn(`q${i}`);
    expect(result.current.sentFiles).toBe(0);
  });
});

describe("readAttachment", () => {
  it("reads base64 and refuses what the API would refuse", async () => {
    expect(await readAttachment(png())).toMatchObject({
      ok: true,
      attachment: { name: "stmt.png", mediaType: "image/png", data: "AQID", size: 3 },
    });
    expect(await readAttachment(png(), ["application/pdf"])).toEqual({
      ok: false,
      problem: "type",
    });
    const empty = new File([], "e.png", { type: "image/png" });
    expect(await readAttachment(empty)).toEqual({ ok: false, problem: "read" });
  });
});

describe("AssistantAttachmentsToggle", () => {
  const renderToggle = (
    enabled: boolean,
    st: AssistantStatus | null = baseStatus(capability()),
  ) => {
    if (st) status = st;
    return render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AssistantProvider serverScope="all">
          <AssistantAttachmentsToggle enabled={enabled} />
        </AssistantProvider>
      </NextIntlClientProvider>,
    );
  };

  it("turns attachments on, off and back, saving the preference", async () => {
    renderToggle(false);
    const sw = screen.getByRole("switch", { name: S.assistantAttachmentsLabel });
    expect(sw).not.toBeChecked();
    fireEvent.click(sw);
    await waitFor(() =>
      expect(client.putPreferences).toHaveBeenCalledWith({ assistantAttachments: true }),
    );
    await waitFor(() => expect(screen.getByRole("switch")).toBeChecked());
    expect(refresh).toHaveBeenCalled();

    // Off needs no confirmation: nothing is stored.
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() =>
      expect(client.putPreferences).toHaveBeenLastCalledWith({ assistantAttachments: false }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("names the provider in the warning once the status is known", async () => {
    renderToggle(false);
    expect(
      await screen.findByText(
        S.assistantAttachmentsWarning.replaceAll("{provider}", "Claude (Anthropic)"),
      ),
    ).toBeInTheDocument();
  });

  it("uses local wording for a provider on the user's own server", async () => {
    renderToggle(false, baseStatus(capability(), true));
    expect(await screen.findByText(S.assistantAttachmentsWarningLocal)).toBeInTheDocument();
  });

  it("falls back to generic wording before the status is known", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AssistantAttachmentsToggle enabled={false} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(S.assistantAttachmentsWarningGeneric)).toBeInTheDocument();
  });

  it("shows an error when saving fails", async () => {
    client.putPreferences.mockRejectedValueOnce(new Error("boom"));
    renderToggle(false);
    fireEvent.click(screen.getByRole("switch"));
    expect(await screen.findByRole("alert")).toHaveTextContent(S.assistantAttachmentsError);
    expect(screen.getByRole("switch")).not.toBeChecked();
  });
});
