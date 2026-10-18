import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import { McpConnectCard } from "@/components/mcp-connect-card";

const copy = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/lib/copy", () => ({ copyToClipboard: copy }));

function renderCard() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <McpConnectCard />
    </NextIntlClientProvider>,
  );
}

describe("McpConnectCard", () => {
  it("shows the Claude Code command and the Desktop config with placeholders", () => {
    renderCard();
    expect(screen.getByText(/claude mcp add --transport http pocket/)).toBeInTheDocument();
    expect(screen.getByText(/mcp-remote/)).toBeInTheDocument();
    expect(screen.getAllByText(/<your-pocket-api-url>\/mcp/).length).toBeGreaterThan(0);
    expect(screen.getByText(/never shared/)).toBeInTheDocument();
  });

  it("renders a valid Claude Desktop config with the pinned bridge", () => {
    const { container } = renderCard();
    const json = [...container.querySelectorAll("code")]
      .map((c) => c.textContent ?? "")
      .find((t) => t.trim().startsWith("{"));
    const cfg = JSON.parse(json!);
    expect(cfg.mcpServers.pocket.command).toBe("npx");
    expect(cfg.mcpServers.pocket.args[1]).toMatch(/^mcp-remote@\d+\.\d+\.\d+$/);
    expect(cfg.mcpServers.pocket.args).toContain("<your-pocket-api-url>/mcp");
  });

  it("copies a snippet and confirms", async () => {
    renderCard();
    fireEvent.click(screen.getAllByRole("button", { name: /copy/i })[0]!);
    await waitFor(() =>
      expect(copy).toHaveBeenCalledWith(expect.stringContaining("claude mcp add")),
    );
    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });

  describe("copy confirmation timer", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    async function copyFirst() {
      // By position: once copied, the first button reads "Copied!" and no longer matches /copy/.
      fireEvent.click(screen.getAllByRole("button")[0]!);
      await act(async () => {});
    }

    it("keeps the confirmation for the full 1.5 s after a second copy", async () => {
      renderCard();
      vi.useFakeTimers();
      await copyFirst();
      expect(screen.getByText("Copied!")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1000));
      await copyFirst();
      // 1.6 s after the first copy, 0.6 s after the second.
      act(() => vi.advanceTimersByTime(600));
      expect(screen.getByText("Copied!")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(900));
      expect(screen.queryByText("Copied!")).not.toBeInTheDocument();
    });

    it("leaves no pending revert after unmount", async () => {
      const view = renderCard();
      vi.useFakeTimers();
      await copyFirst();
      expect(vi.getTimerCount()).toBe(1);
      view.unmount();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
