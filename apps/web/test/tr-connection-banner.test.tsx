import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { TrConnection } from "@portfolio/api-client";
import messages from "../messages/en.json";

const refresh = vi.fn();
const api = {
  connectTr: vi.fn(),
  cancelTrPairing: vi.fn(async () => undefined),
  renewTr: vi.fn(async () => ({ status: "awaiting_2fa" as const, method: "push" as const })),
  verifyTr: vi.fn(async () => ({ status: "connected" as const })),
  syncTr: vi.fn(async () => ({ queued: true })),
  disconnectTr: vi.fn(),
  reimportTr: vi.fn(),
  reprocessTrDocuments: vi.fn(),
  getTrConnection: vi.fn(async () => ({
    status: "connected" as const,
    portfolioId: "p1",
    lastSyncAt: null,
    lastError: null,
    lastReconciliation: null,
    syncing: false,
  })),
};

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("@/lib/api", () => ({ useApiClient: () => api }));

import { TrConnectionBanner } from "../src/components/holdings/tr-connection-banner";

const base: TrConnection = {
  status: "expired",
  portfolioId: "p1",
  lastSyncAt: null,
  lastError: "Trade Republic session expired",
  lastReconciliation: null,
  syncing: false,
};

function renderBanner(connection: TrConnection | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TrConnectionBanner connection={connection} />
    </NextIntlClientProvider>,
  );
}

describe("TrConnectionBanner", () => {
  it.each([
    ["no connection", null],
    ["connected", { ...base, status: "connected" as const }],
    ["disconnected", { ...base, status: "disconnected" as const }],
    ["mid-pairing", { ...base, status: "awaiting_2fa" as const }],
    ["unbound to a portfolio", { ...base, portfolioId: null }],
  ])("renders nothing for %s", (_name, connection) => {
    const { container } = renderBanner(connection);
    expect(container.textContent).toBe("");
  });

  it("flags an expired login and renews it in one tap, then syncs and refreshes", async () => {
    renderBanner(base);
    expect(screen.getByText(/Trade Republic login expired/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Renew" }));
    fireEvent.click(await screen.findByRole("button", { name: /Renew login/ }));

    await waitFor(() => expect(api.renewTr).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.syncTr).toHaveBeenCalled(), { timeout: 5000 });
    expect(refresh).toHaveBeenCalled();
  });

  it("a cancelled renew neither syncs nor closes the dialog", async () => {
    api.syncTr.mockClear();
    api.getTrConnection.mockResolvedValueOnce({
      status: "expired" as never,
      portfolioId: "p1",
      lastSyncAt: null,
      lastError: null,
      lastReconciliation: null,
      syncing: false,
    });
    renderBanner(base);
    fireEvent.click(screen.getByRole("button", { name: "Renew" }));
    fireEvent.click(await screen.findByRole("button", { name: /Renew login/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(api.cancelTrPairing).toHaveBeenCalled());
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(api.syncTr).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Renew login/ })).toBeTruthy();
  });

  it("keeps prompting after a renew was abandoned (awaiting_2fa with no pairing behind it)", () => {
    renderBanner({
      ...base,
      status: "awaiting_2fa",
      pairingMethod: null,
      lastSyncAt: "2026-11-15T10:00:00.000Z" as unknown as TrConnection["lastSyncAt"],
    });
    expect(screen.getByText(/Trade Republic login expired/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Renew" })).toBeTruthy();
  });

  it("does not nag about a first setup that never synced", () => {
    const { container } = renderBanner({
      ...base,
      status: "awaiting_2fa",
      pairingMethod: null,
      lastSyncAt: null,
    });
    expect(container.textContent).toBe("");
  });

  it("does not prompt while a pairing is genuinely in flight", () => {
    const { container } = renderBanner({
      ...base,
      status: "awaiting_2fa",
      pairingMethod: "push",
      lastSyncAt: "2026-11-15T10:00:00.000Z" as unknown as TrConnection["lastSyncAt"],
    });
    expect(container.textContent).toBe("");
  });

  it("explains a failed sync in the dialog, not an expired login", async () => {
    renderBanner({ ...base, status: "error" });
    fireEvent.click(screen.getByRole("button", { name: "Renew" }));
    expect(await screen.findByText(/last Trade Republic sync failed/)).toBeTruthy();
  });

  it("flags a failed sync with its own wording", () => {
    renderBanner({ ...base, status: "error" });
    expect(screen.getByText(/sync needs attention/)).toBeTruthy();
  });
});
