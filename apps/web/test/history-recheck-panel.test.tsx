import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ApiError } from "@portfolio/api-client";
import {
  HistoryRecheckPanel,
  type HistoryRecheckClient,
} from "../src/components/history-recheck-panel";
import messages from "../messages/en.json";

const m = messages.Settings;

function renderPanel(triggerMyBackfill: HistoryRecheckClient["triggerMyBackfill"]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <HistoryRecheckPanel client={{ triggerMyBackfill }} />
    </NextIntlClientProvider>,
  );
}

const click = () => fireEvent.click(screen.getByRole("button", { name: m.historyRecheckRun }));

describe("HistoryRecheckPanel", () => {
  it("queues a re-check and says it was queued", async () => {
    const fn = vi.fn().mockResolvedValue({ queued: true, retryDeadFeeds: false });
    renderPanel(fn);
    click();
    await waitFor(() => expect(screen.getByText(m.historyRecheckQueued)).toBeTruthy());
    expect(fn).toHaveBeenCalledWith({ retryDeadFeeds: false });
  });

  it("passes the dead-feed opt-in when ticked", async () => {
    const fn = vi.fn().mockResolvedValue({ queued: true, retryDeadFeeds: true });
    renderPanel(fn);
    fireEvent.click(screen.getByRole("checkbox"));
    click();
    await waitFor(() => expect(fn).toHaveBeenCalledWith({ retryDeadFeeds: true }));
  });

  it.each([
    [409, "already_in_flight", m.historyRecheckAlreadyQueued],
    [429, "backfill_rate_limited", m.historyRecheckRateLimited],
    [503, "scheduler_unavailable", m.historyRecheckUnavailable],
  ])("maps %i %s to its own message", async (status, code, text) => {
    const fn = vi.fn().mockRejectedValue(new ApiError(status, JSON.stringify({ error: code })));
    renderPanel(fn);
    click();
    await waitFor(() => expect(screen.getByText(text)).toBeTruthy());
  });

  it("shows a generic error for anything else", async () => {
    renderPanel(vi.fn().mockRejectedValue(new Error("boom")));
    click();
    await waitFor(() => expect(screen.getByText(m.historyRecheckError)).toBeTruthy());
  });
});
