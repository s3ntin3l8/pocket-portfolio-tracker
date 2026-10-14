import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { IbkrConnection, TrConnection } from "@portfolio/api-client";
import { ApiError } from "@portfolio/api-client";
import { TrConnectFlow, type TrConnectClient } from "../src/components/tr-connect-flow";
import { IbkrConnectFlow, type IbkrConnectClient } from "../src/components/ibkr-connect-flow";
import messages from "../messages/en.json";

const RECON = {
  cash: [{ currency: "EUR", reported: "100.00", derived: "99.5", diff: "0.5" }],
} as unknown as TrConnection["lastReconciliation"];

const TR_CONNECTED: TrConnection = {
  status: "connected",
  portfolioId: "p1",
  lastSyncAt: "2026-10-01T10:00:00Z",
  lastError: null,
  lastReconciliation: RECON,
  syncing: false,
};

const IBKR_CONNECTED: IbkrConnection = {
  status: "connected",
  portfolioId: "p1",
  flexAccountId: "U123",
  lastSyncAt: "2026-10-01T10:00:00Z",
  lastError: null,
  lastReconciliation: RECON,
  syncing: false,
};

function trClient(): TrConnectClient {
  return {
    connectTr: vi.fn(),
    verifyTr: vi.fn(),
    syncTr: vi.fn(async () => ({ status: "connected" as const, drafts: 0 })),
    disconnectTr: vi.fn(async () => undefined),
    getTrConnection: vi.fn(),
    reimportTr: vi.fn(async () => ({ removed: 0 })),
    reprocessTrDocuments: vi.fn(async () => ({ processed: 0 })),
  } as unknown as TrConnectClient;
}

function ibkrClient(over: Partial<IbkrConnectClient> = {}): IbkrConnectClient {
  return {
    connectIbkr: vi.fn(async () => ({ status: "connected" as const })),
    syncIbkr: vi.fn(async () => ({ status: "connected" as const })),
    disconnectIbkr: vi.fn(async () => undefined),
    getIbkrConnection: vi.fn(),
    reimportIbkr: vi.fn(async () => ({ removed: 0 })),
    ...over,
  } as unknown as IbkrConnectClient;
}

function wrap(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

// Radix opens its dropdown on keyboard events, not a synthetic click (see
// portfolio-card-menu.test.tsx).
function openMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: "More options" }), { key: "Enter" });
}

describe("TrConnectFlow compact", () => {
  const renderTr = (initial: TrConnection, client = trClient()) => {
    const onChanged = vi.fn();
    wrap(
      <TrConnectFlow
        client={client}
        portfolioId="p1"
        cashCounted={false}
        initial={initial}
        onChanged={onChanged}
        compact
      />,
    );
    return { client, onChanged };
  };

  it("collapses the connected state to last sync + Sync + a menu", () => {
    renderTr(TR_CONNECTED);
    expect(screen.getByText(new RegExp(messages.BrokerConnection.lastSync))).toBeTruthy();
    expect(screen.getByRole("button", { name: /Sync now/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: messages.TradeRepublic.disconnect })).toBeNull();
    expect(screen.queryByText(messages.TradeRepublic.reimport.action)).toBeNull();
  });

  it("shows 'Never' when nothing has synced yet", () => {
    renderTr({ ...TR_CONNECTED, lastSyncAt: null });
    expect(screen.getByText(new RegExp(messages.BrokerConnection.never))).toBeTruthy();
  });

  it("syncs from the primary button", async () => {
    const { client, onChanged } = renderTr(TR_CONNECTED);
    fireEvent.click(screen.getByRole("button", { name: /Sync now/ }));
    await waitFor(() => expect(client.syncTr).toHaveBeenCalled());
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("asks before disconnecting, then disconnects", async () => {
    const { client } = renderTr(TR_CONNECTED);
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Disconnect" }));
    expect(client.disconnectTr).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(client.disconnectTr).toHaveBeenCalled());
  });

  it("asks before re-importing, then re-imports", async () => {
    const { client } = renderTr(TR_CONNECTED);
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: /Re-import everything/ }));
    expect(client.reimportTr).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: /Delete & re-import/ }));
    await waitFor(() => expect(client.reimportTr).toHaveBeenCalled());
  });

  it("re-processes documents from the menu", async () => {
    const { client } = renderTr(TR_CONNECTED);
    openMenu();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: messages.TradeRepublic.reprocess.action }),
    );
    await waitFor(() => expect(client.reprocessTrDocuments).toHaveBeenCalled());
  });

  it("keeps the reconcile summary behind the details disclosure", () => {
    renderTr(TR_CONNECTED);
    const details = screen.getByText(messages.BrokerConnection.details).closest("details")!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain(messages.TradeRepublic.reconcile.title);
  });

  it("falls back to the full flow for every non-connected status", () => {
    renderTr({ ...TR_CONNECTED, status: "expired" });
    expect(screen.queryByRole("button", { name: "More options" })).toBeNull();
    expect(screen.getByText(messages.TradeRepublic.expiredHint)).toBeTruthy();
  });
});

describe("IbkrConnectFlow", () => {
  const renderIbkr = (initial: IbkrConnection, client = ibkrClient(), compact = false) => {
    const onChanged = vi.fn();
    wrap(
      <IbkrConnectFlow
        client={client}
        portfolioId="p1"
        initial={initial}
        onChanged={onChanged}
        compact={compact}
      />,
    );
    return { client, onChanged };
  };

  it("compact: shows last sync + Sync + menu, with the account id behind details", () => {
    renderIbkr(IBKR_CONNECTED, ibkrClient(), true);
    expect(screen.getByRole("button", { name: /Sync now/ })).toBeTruthy();
    const details = screen.getByText(messages.BrokerConnection.details).closest("details")!;
    expect(details.textContent).toContain("U123");
    expect(details.textContent).toContain(messages.InteractiveBrokers.reconcile.title);
  });

  it("compact: syncs, and disconnect / re-import are confirmed from the menu", async () => {
    const { client, onChanged } = renderIbkr(IBKR_CONNECTED, ibkrClient(), true);
    fireEvent.click(screen.getByRole("button", { name: /Sync now/ }));
    await waitFor(() => expect(client.syncIbkr).toHaveBeenCalled());
    await waitFor(() => expect(onChanged).toHaveBeenCalled());

    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: /Re-import everything/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Delete & re-import/ }));
    await waitFor(() => expect(client.reimportIbkr).toHaveBeenCalled());

    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Disconnect" }));
    expect(client.disconnectIbkr).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(client.disconnectIbkr).toHaveBeenCalled());
  });

  it("compact: a non-connected status keeps the full connect form", () => {
    renderIbkr({ ...IBKR_CONNECTED, status: "expired" }, ibkrClient(), true);
    expect(screen.queryByRole("button", { name: "More options" })).toBeNull();
    expect(screen.getByLabelText(messages.InteractiveBrokers.flexToken)).toBeTruthy();
  });

  it("full (not compact): still renders the whole connected body", async () => {
    const { client } = renderIbkr(IBKR_CONNECTED);
    expect(screen.getByText(messages.InteractiveBrokers.connectedHint)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "More options" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(client.disconnectIbkr).toHaveBeenCalled());
  });

  it("connects with a token + query id and surfaces API errors", async () => {
    const disconnected: IbkrConnection = {
      ...IBKR_CONNECTED,
      status: "disconnected",
      portfolioId: null,
      flexAccountId: null,
      lastSyncAt: null,
      lastReconciliation: null,
    };
    const failing = ibkrClient({
      connectIbkr: vi.fn(async () => {
        throw new ApiError(400, "bad", undefined);
      }),
    });
    const { onChanged } = renderIbkr(disconnected, failing);
    fireEvent.change(screen.getByLabelText(messages.InteractiveBrokers.flexToken), {
      target: { value: "tok" },
    });
    fireEvent.change(screen.getByLabelText(messages.InteractiveBrokers.queryId), {
      target: { value: "123" },
    });
    fireEvent.click(screen.getByRole("button", { name: messages.InteractiveBrokers.connect }));
    await waitFor(() => expect(failing.connectIbkr).toHaveBeenCalled());
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
