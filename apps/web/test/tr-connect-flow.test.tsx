import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { TrConnectFlow, type TrConnectClient } from "../src/components/tr-connect-flow";
import { ApiError } from "@portfolio/api-client";
import type { TrConnection } from "@portfolio/api-client";
import messages from "../messages/en.json";

function makeClient(over: Partial<TrConnectClient> = {}): TrConnectClient {
  return {
    connectTr: vi.fn(async () => ({ status: "awaiting_2fa" as const, method: "push" as const })),
    renewTr: vi.fn(async () => ({ status: "awaiting_2fa" as const, method: "push" as const })),
    cancelTrPairing: vi.fn(async () => undefined),
    // Never settles on its own: keeps the awaiting phase (and its Cancel button) on screen.
    verifyTr: vi.fn(async () => ({ status: "connected" as const })),
    syncTr: vi.fn(async () => ({ status: "connected" as const, drafts: 3 })),
    disconnectTr: vi.fn(async () => undefined),
    reimportTr: vi.fn(async () => ({ removed: 0 })),
    reprocessTrDocuments: vi.fn(async () => ({ processed: 0 })),
    // The awaiting phase polls this for the authoritative status; default = approved.
    getTrConnection: vi.fn(async () => ({
      status: "connected" as const,
      portfolioId: "p1",
      lastSyncAt: null,
      lastError: null,
      lastReconciliation: null,
      syncing: false,
    })),
    ...over,
  };
}

const DISCONNECTED: TrConnection = {
  status: "disconnected",
  portfolioId: null,
  lastSyncAt: null,
  lastError: null,
  lastReconciliation: null,
  syncing: false,
};

function renderFlow(
  client: TrConnectClient,
  initial: TrConnection = DISCONNECTED,
  cashCounted = false,
) {
  const onChanged = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TrConnectFlow
        client={client}
        portfolioId="p1"
        cashCounted={cashCounted}
        initial={initial}
        onChanged={onChanged}
      />
    </NextIntlClientProvider>,
  );
  return onChanged;
}

const CONNECTED: TrConnection = {
  status: "connected",
  portfolioId: "p1",
  lastSyncAt: null,
  lastError: null,
  lastReconciliation: null,
  syncing: false,
};

describe("TrConnectFlow", () => {
  it("walks connect → awaiting approval → connected (auto-polls, no code)", async () => {
    const client = makeClient();
    const onChanged = renderFlow(client);

    fireEvent.change(screen.getByLabelText("Phone number"), {
      target: { value: "+4915112345678" },
    });
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: /Connect/ }));

    await waitFor(() =>
      expect(client.connectTr).toHaveBeenCalledWith({
        phone: "+4915112345678",
        pin: "1234",
        portfolioId: "p1",
      }),
    );

    // The awaiting step fires verify once (no confirmation code), then the status poll
    // observes the authoritative connection state.
    await waitFor(() => expect(client.verifyTr).toHaveBeenCalledWith());
    expect(await screen.findByRole("button", { name: /Sync now/ }, { timeout: 4000 })).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
  });

  it("reflects a connected status even when the verify request fails on the client", async () => {
    // The regression: the client-side verify can reject (StrictMode remount, token
    // rotation, HMR, a transient drop) while Fastify still completes the pairing. The
    // status poll is the source of truth, so the UI must still land on connected.
    const client = makeClient({
      verifyTr: vi.fn(async () => {
        throw new Error("client request aborted");
      }),
    });
    renderFlow(client);
    fireEvent.change(screen.getByLabelText("Phone number"), {
      target: { value: "+49150" },
    });
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: /Connect/ }));

    expect(await screen.findByRole("button", { name: /Sync now/ }, { timeout: 4000 })).toBeTruthy();
  });

  it("returns to the form with an error when the status poll reports a failed pairing", async () => {
    const client = makeClient({
      getTrConnection: vi.fn(async () => ({
        status: "error" as const,
        portfolioId: "p1",
        lastSyncAt: null,
        lastError: "login was not approved",
        lastReconciliation: null,
        syncing: false,
      })),
    });
    renderFlow(client);
    fireEvent.change(screen.getByLabelText("Phone number"), {
      target: { value: "+49150" },
    });
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: /Connect/ }));

    expect(await screen.findByRole("alert", {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Connect/ })).toBeTruthy();
  });

  describe("authenticator-app (TOTP) pairing", () => {
    // The poll keeps reporting a live authenticator pairing until verify completes it.
    const AWAITING_CODE: TrConnection = {
      ...DISCONNECTED,
      status: "awaiting_2fa",
      portfolioId: "p1",
      pairingMethod: "authenticator",
    };
    const totpClient = (over: Partial<TrConnectClient> = {}) =>
      makeClient({
        connectTr: vi.fn(async () => ({
          status: "awaiting_2fa" as const,
          method: "authenticator" as const,
        })),
        getTrConnection: vi.fn(async () => AWAITING_CODE),
        ...over,
      });
    const connect = async () => {
      fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "+49150" } });
      fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1234" } });
      fireEvent.click(screen.getByRole("button", { name: /Connect/ }));
      return screen.findByLabelText("Authenticator code");
    };

    it("asks for the code instead of verifying right away, then sends it", async () => {
      const client = totpClient();
      renderFlow(client);
      const input = await connect();
      expect(client.verifyTr).not.toHaveBeenCalled();

      fireEvent.change(input, { target: { value: "123456" } });
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      await waitFor(() => expect(client.verifyTr).toHaveBeenCalledWith({ code: "123456" }));
      expect(await screen.findByText("Waiting for approval…")).toBeTruthy();
    });

    it("sends the code once when Continue is pressed twice in a row", async () => {
      const client = totpClient({ verifyTr: vi.fn(() => new Promise<never>(() => undefined)) });
      renderFlow(client);
      const input = await connect();
      fireEvent.change(input, { target: { value: "123456" } });
      const form = input.closest("form")!;
      fireEvent.submit(form);
      fireEvent.submit(form);
      expect(client.verifyTr).toHaveBeenCalledTimes(1);
    });

    it("keeps Continue disabled until the code has six digits", async () => {
      renderFlow(totpClient());
      const input = await connect();
      fireEvent.change(input, { target: { value: "12ab34" } });
      expect((input as HTMLInputElement).value).toBe("1234");
      expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(
        true,
      );
    });

    it("returns to the code field with a message when the code is refused", async () => {
      const client = totpClient({
        verifyTr: vi.fn(async () => {
          throw new ApiError(400, JSON.stringify({ error: "code_invalid" }));
        }),
      });
      renderFlow(client);
      const input = await connect();
      fireEvent.change(input, { target: { value: "000000" } });
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));

      expect(await screen.findByRole("alert")).toBeTruthy();
      expect(screen.getByText(/wasn't accepted/)).toBeTruthy();
      expect(((await screen.findByLabelText("Authenticator code")) as HTMLInputElement).value).toBe(
        "",
      );
    });

    it("opens straight on the code field when an authenticator pairing is already pending", () => {
      renderFlow(totpClient(), AWAITING_CODE);
      expect(screen.getByLabelText("Authenticator code")).toBeTruthy();
    });

    it("falls back to the form when the server forgot the pairing", async () => {
      const client = totpClient({
        getTrConnection: vi.fn(async () => ({ ...AWAITING_CODE, pairingMethod: null })),
      });
      renderFlow(client, AWAITING_CODE);
      expect(await screen.findByRole("alert", {}, { timeout: 4000 })).toBeTruthy();
      expect(screen.getByRole("button", { name: /Connect/ })).toBeTruthy();
    });
  });

  it("passes a pasted waf token from the advanced field", async () => {
    const client = makeClient();
    renderFlow(client);
    fireEvent.change(screen.getByLabelText("Phone number"), {
      target: { value: "+49150" },
    });
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    fireEvent.change(screen.getByLabelText(/aws-waf-token/), {
      target: { value: "tok-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Connect/ }));

    await waitFor(() =>
      expect(client.connectTr).toHaveBeenCalledWith(
        expect.objectContaining({ wafToken: "tok-123" }),
      ),
    );
  });

  it("syncs from the connected state and calls syncTr", async () => {
    const client = makeClient();
    const onChanged = renderFlow(client, CONNECTED);
    fireEvent.click(screen.getByRole("button", { name: /Sync now/ }));
    await waitFor(() => expect(client.syncTr).toHaveBeenCalled());
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("re-processes retained PDFs from the connected state", async () => {
    const client = makeClient();
    renderFlow(client, CONNECTED);
    fireEvent.click(screen.getByText(messages.TradeRepublic.reprocess.action));
    await waitFor(() => expect(client.reprocessTrDocuments).toHaveBeenCalled());
    expect(await screen.findByText(messages.TradeRepublic.reprocess.done)).toBeTruthy();
  });

  it("shows the reconnect hint when the session expired", () => {
    renderFlow(makeClient(), {
      status: "expired",
      portfolioId: "p1",
      lastSyncAt: null,
      lastError: "session expired",
      lastReconciliation: null,
      syncing: false,
    });
    expect(screen.getByText(/Your session expired/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Connect/ })).toBeTruthy();
  });

  it("renews an expired login in one tap with no credentials typed", async () => {
    const client = makeClient();
    const onChanged = renderFlow(client, {
      status: "expired",
      portfolioId: "p1",
      lastSyncAt: null,
      lastError: "Trade Republic session expired",
      lastReconciliation: null,
      syncing: false,
    });

    fireEvent.click(screen.getByRole("button", { name: /Renew login/ }));

    await waitFor(() => expect(client.renewTr).toHaveBeenCalledTimes(1));
    expect(client.connectTr).not.toHaveBeenCalled();
    // Same completion path as a first pairing: verify fires, the poll sees `connected`.
    await waitFor(() => expect(client.verifyTr).toHaveBeenCalledWith());
    expect(await screen.findByRole("button", { name: /Sync now/ }, { timeout: 4000 })).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
  });

  it("points a failed renew at the WAF token field and expands it", async () => {
    const client = makeClient({
      renewTr: vi.fn(async () => {
        throw new ApiError(502, JSON.stringify({ error: "tr_pairing_failed" }));
      }),
    });
    renderFlow(client, {
      status: "expired",
      portfolioId: "p1",
      lastSyncAt: null,
      lastError: "Trade Republic session expired",
      lastReconciliation: null,
      syncing: false,
    });
    expect(screen.queryByLabelText(/aws-waf-token/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Renew login/ }));

    expect(await screen.findByText(/paste an aws-waf-token/)).toBeTruthy();
    expect(screen.getByLabelText(/aws-waf-token/)).toBeTruthy();
    expect(client.connectTr).not.toHaveBeenCalled();
  });

  it("cancelling a renew keeps the saved credentials (no disconnect)", async () => {
    const client = makeClient({
      verifyTr: vi.fn(() => new Promise<{ status: "connected" }>(() => undefined)),
      getTrConnection: vi.fn(async () => ({
        status: "awaiting_2fa" as const,
        portfolioId: "p1",
        lastSyncAt: null,
        lastError: null,
        lastReconciliation: null,
        syncing: false,
        pairingMethod: "push" as const,
      })),
    });
    renderFlow(client, {
      status: "expired",
      portfolioId: "p1",
      lastSyncAt: null,
      lastError: "Trade Republic session expired",
      lastReconciliation: null,
      syncing: false,
    });
    fireEvent.click(screen.getByRole("button", { name: /Renew login/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(client.cancelTrPairing).toHaveBeenCalledTimes(1));
    expect(client.disconnectTr).not.toHaveBeenCalled();
    // Back on the form with the one-tap Renew still offered.
    expect(await screen.findByRole("button", { name: /Renew login/ })).toBeTruthy();
  });

  it("cancelling a first pairing still discards it", async () => {
    const client = makeClient({
      verifyTr: vi.fn(() => new Promise<{ status: "connected" }>(() => undefined)),
      getTrConnection: vi.fn(async () => ({
        status: "awaiting_2fa" as const,
        portfolioId: "p1",
        lastSyncAt: null,
        lastError: null,
        lastReconciliation: null,
        syncing: false,
        pairingMethod: "push" as const,
      })),
    });
    renderFlow(client);
    fireEvent.change(screen.getByLabelText("Phone number"), {
      target: { value: "+4915112345678" },
    });
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: /Connect/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(client.disconnectTr).toHaveBeenCalledTimes(1));
    expect(client.cancelTrPairing).not.toHaveBeenCalled();
  });

  it("offers no renew for a never-connected or healthy connection", () => {
    renderFlow(makeClient());
    expect(screen.queryByRole("button", { name: /Renew login/ })).toBeNull();
  });

  it("shows the failure reason and a renew button after a failed sync", () => {
    renderFlow(makeClient(), {
      status: "error",
      portfolioId: "p1",
      lastSyncAt: null,
      lastError: "pytr failed (see server logs)",
      lastReconciliation: null,
      syncing: false,
    });
    expect(screen.getByText("pytr failed (see server logs)")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Renew login/ })).toBeTruthy();
  });

  it("surfaces an error when connect fails", async () => {
    const client = makeClient({
      connectTr: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    renderFlow(client);
    fireEvent.change(screen.getByLabelText("Phone number"), {
      target: { value: "+49150" },
    });
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: /Connect/ }));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("shows a specific message for a known API error code", async () => {
    const client = makeClient({
      connectTr: vi.fn(async () => {
        throw new ApiError(503, JSON.stringify({ error: "pytr_not_available" }));
      }),
    });
    renderFlow(client);
    fireEvent.change(screen.getByLabelText("Phone number"), {
      target: { value: "+49150" },
    });
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: /Connect/ }));
    expect(await screen.findByText(/Trade Republic sync isn't set up on the server/)).toBeTruthy();
  });

  it("binds to the portfolio it was given, with no in-form picker", async () => {
    // TrConnectFlow is launched from a single portfolio's edit dialog, so the binding is
    // implicit (the prop) — there's no portfolio selector in the form.
    const client = makeClient();
    renderFlow(client);
    expect(screen.queryByLabelText("Import into")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Phone number"), {
      target: { value: "+49150" },
    });
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: /Connect/ }));
    await waitFor(() =>
      expect(client.connectTr).toHaveBeenCalledWith(expect.objectContaining({ portfolioId: "p1" })),
    );
  });

  it("explains the import scope from the portfolio's cash boundary, with no category toggles (#326)", () => {
    // Cash-inside: everything imported (incl. cash movements). Cash-outside: cash excluded.
    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <TrConnectFlow client={makeClient()} portfolioId="p1" cashCounted initial={CONNECTED} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(messages.TradeRepublic.scope.cashInside)).toBeTruthy();
    // The old free category checkboxes are gone — the scope is derived, not chosen.
    expect(screen.queryByText("Card spending")).not.toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <TrConnectFlow
          client={makeClient()}
          portfolioId="p1"
          cashCounted={false}
          initial={CONNECTED}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(messages.TradeRepublic.scope.cashOutside)).toBeTruthy();
  });
});
