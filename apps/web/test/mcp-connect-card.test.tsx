import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import { McpConnectCard } from "@/components/mcp-connect-card";

const copy = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/components/api-tokens-manager", () => ({ copyToClipboard: copy }));

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

  it("copies a snippet and confirms", async () => {
    renderCard();
    fireEvent.click(screen.getAllByRole("button", { name: /copy/i })[0]!);
    await waitFor(() =>
      expect(copy).toHaveBeenCalledWith(expect.stringContaining("claude mcp add")),
    );
    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });
});
