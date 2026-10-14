import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
});
