import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ApiToken } from "@portfolio/api-client";
import { ApiTokensManager, type ApiTokensClient } from "../src/components/api-tokens-manager";
import messages from "../messages/en.json";

const m = messages.Settings;

const existing: ApiToken = {
  id: "tok-1",
  name: "old-cli",
  tokenPrefix: "pt_abcdefg",
  scope: "read",
  lastUsedAt: "2026-06-01T10:00:00.000Z",
  expiresAt: null,
  createdAt: "2026-05-01T10:00:00.000Z",
};

function renderManager(client: ApiTokensClient, initialTokens: ApiToken[] = []) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ApiTokensManager client={client} initialTokens={initialTokens} />
    </NextIntlClientProvider>,
  );
}

/** Opens the create-token modal (design: "Create token" pill below the row list). */
function openCreateModal() {
  fireEvent.click(screen.getByRole("button", { name: m.tokensCreate }));
  return within(screen.getByRole("dialog"));
}

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn(async () => undefined) },
  });
});

describe("ApiTokensManager", () => {
  it("renders each token as a card row with a scope pill — no data table", () => {
    renderManager({ listApiTokens: vi.fn(), createApiToken: vi.fn(), deleteApiToken: vi.fn() }, [
      existing,
    ]);
    expect(screen.getByText("old-cli")).toBeInTheDocument();
    expect(screen.getByText(m.tokensScopeRead)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("creates a token via the modal and shows the secret once", async () => {
    const created = { ...existing, id: "tok-2", name: "dev-cli", token: "pt_supersecret" };
    const client: ApiTokensClient = {
      listApiTokens: vi.fn(async () => [existing, { ...created, token: undefined } as never]),
      createApiToken: vi.fn(async () => created),
      deleteApiToken: vi.fn(),
    };
    renderManager(client, [existing]);

    const dialog = openCreateModal();
    // Shown twice by design: the mobile header and the (mobile-hidden) accessible DialogTitle.
    expect(dialog.getAllByText(m.tokensCreateTitle)).toHaveLength(2);
    fireEvent.change(dialog.getByLabelText(m.tokensName), { target: { value: "dev-cli" } });
    fireEvent.click(dialog.getByRole("button", { name: m.tokensCreate }));

    await waitFor(() => expect(screen.getByText("pt_supersecret")).toBeInTheDocument());
    expect(client.createApiToken).toHaveBeenCalledWith({ name: "dev-cli", scope: "read" });
    expect(screen.getByText(m.tokensCreatedWarning)).toBeInTheDocument();
  });

  it("copies the secret and confirms via the Clipboard API", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const client: ApiTokensClient = {
      listApiTokens: vi.fn(async () => []),
      createApiToken: vi.fn(async () => ({ ...existing, token: "pt_copyme" })),
      deleteApiToken: vi.fn(),
    };
    renderManager(client);

    const dialog = openCreateModal();
    fireEvent.change(dialog.getByLabelText(m.tokensName), { target: { value: "c" } });
    fireEvent.click(dialog.getByRole("button", { name: m.tokensCreate }));
    await screen.findByText("pt_copyme");

    fireEvent.click(screen.getByRole("button", { name: m.tokensCopy }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("pt_copyme"));
    await screen.findByText(m.tokensCopied);
  });

  describe("copy confirmation timer", () => {
    afterEach(() => {
      // Spies first: the setTimeout spy wraps the fake timer, so restoring it after
      // useRealTimers() would put the fake back.
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    /** Creates a token so its secret (and the Copy button) is on screen, then fakes timers. */
    async function showSecret() {
      const client: ApiTokensClient = {
        listApiTokens: vi.fn(async () => []),
        createApiToken: vi.fn(async () => ({ ...existing, token: "pt_copyme" })),
        deleteApiToken: vi.fn(),
      };
      const view = renderManager(client);
      const dialog = openCreateModal();
      fireEvent.change(dialog.getByLabelText(m.tokensName), { target: { value: "c" } });
      fireEvent.click(dialog.getByRole("button", { name: m.tokensCreate }));
      await screen.findByText("pt_copyme");
      vi.useFakeTimers();
      return view;
    }

    async function copy(name: string) {
      fireEvent.click(screen.getByRole("button", { name }));
      // Let the async clipboard write resolve and the label update.
      await act(async () => {});
    }

    it("keeps the confirmation for the full 2 s after a second copy", async () => {
      await showSecret();
      await copy(m.tokensCopy);
      expect(screen.getByText(m.tokensCopied)).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1500));
      await copy(m.tokensCopied);
      // 2.1 s after the first copy, 0.6 s after the second: the first copy's timer must not
      // revert the label the second copy just confirmed.
      act(() => vi.advanceTimersByTime(600));
      expect(screen.getByText(m.tokensCopied)).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1500));
      expect(screen.getByText(m.tokensCopy)).toBeInTheDocument();
    });

    it("clears the pending revert on unmount, so no state update outlives the component", async () => {
      const view = await showSecret();
      const scheduled = vi.spyOn(globalThis, "setTimeout");
      await copy(m.tokensCopy);
      // The confirmation's own 2 s revert (other timers belong to the dialog and React).
      const revert = scheduled.mock.calls.findIndex(([, ms]) => ms === 2000);
      expect(revert).toBeGreaterThanOrEqual(0);
      const id = scheduled.mock.results[revert]!.value;
      const cleared = vi.spyOn(globalThis, "clearTimeout");
      view.unmount();
      expect(cleared).toHaveBeenCalledWith(id);
    });
  });

  it("falls back to execCommand when the Clipboard API is unavailable (insecure context)", async () => {
    // Simulate http-on-LAN-IP: no navigator.clipboard.
    Object.assign(navigator, { clipboard: undefined });
    const exec = vi.fn(() => true);
    document.execCommand = exec as unknown as typeof document.execCommand;
    const client: ApiTokensClient = {
      listApiTokens: vi.fn(async () => []),
      createApiToken: vi.fn(async () => ({ ...existing, token: "pt_fallback" })),
      deleteApiToken: vi.fn(),
    };
    renderManager(client);

    const dialog = openCreateModal();
    fireEvent.change(dialog.getByLabelText(m.tokensName), { target: { value: "c" } });
    fireEvent.click(dialog.getByRole("button", { name: m.tokensCreate }));
    await screen.findByText("pt_fallback");

    fireEvent.click(screen.getByRole("button", { name: m.tokensCopy }));
    await waitFor(() => expect(exec).toHaveBeenCalledWith("copy"));
    await screen.findByText(m.tokensCopied);
  });

  it("passes an expiry when an Expires chip is selected", async () => {
    const client: ApiTokensClient = {
      listApiTokens: vi.fn(async () => []),
      createApiToken: vi.fn(async () => ({ ...existing, token: "pt_x" })),
      deleteApiToken: vi.fn(),
    };
    renderManager(client);

    const dialog = openCreateModal();
    fireEvent.change(dialog.getByLabelText(m.tokensName), { target: { value: "temp" } });
    fireEvent.click(dialog.getByRole("radio", { name: m.tokensExpiry30 }));
    fireEvent.click(dialog.getByRole("button", { name: m.tokensCreate }));

    await waitFor(() =>
      expect(client.createApiToken).toHaveBeenCalledWith({
        name: "temp",
        scope: "read",
        expiresInDays: 30,
      }),
    );
  });

  it("defaults to no-expiry note and switches on selecting a day chip", () => {
    renderManager({ listApiTokens: vi.fn(), createApiToken: vi.fn(), deleteApiToken: vi.fn() });
    const dialog = openCreateModal();
    expect(dialog.getByText(m.tokensExpiryNoteNever)).toBeInTheDocument();

    fireEvent.click(dialog.getByRole("radio", { name: m.tokensExpiry90 }));
    expect(dialog.getByText("Stops working automatically after 90 days.")).toBeInTheDocument();
  });

  it("selects a Read & write scope chip", async () => {
    const client: ApiTokensClient = {
      listApiTokens: vi.fn(async () => []),
      createApiToken: vi.fn(async () => ({ ...existing, token: "pt_w" })),
      deleteApiToken: vi.fn(),
    };
    renderManager(client);

    const dialog = openCreateModal();
    fireEvent.change(dialog.getByLabelText(m.tokensName), { target: { value: "writer" } });
    fireEvent.click(dialog.getByRole("radio", { name: m.tokensScopeWrite }));
    fireEvent.click(dialog.getByRole("button", { name: m.tokensCreate }));

    await waitFor(() =>
      expect(client.createApiToken).toHaveBeenCalledWith({ name: "writer", scope: "write" }),
    );
  });

  it("closes the modal via Cancel without creating a token", () => {
    const client: ApiTokensClient = {
      listApiTokens: vi.fn(),
      createApiToken: vi.fn(),
      deleteApiToken: vi.fn(),
    };
    renderManager(client);

    const dialog = openCreateModal();
    fireEvent.click(dialog.getByRole("button", { name: m.tokensCancel }));
    expect(screen.queryByText(m.tokensCreateTitle)).not.toBeInTheDocument();
    expect(client.createApiToken).not.toHaveBeenCalled();
  });

  it("revokes a token and removes it from the list", async () => {
    const client: ApiTokensClient = {
      listApiTokens: vi.fn(async () => []),
      createApiToken: vi.fn(),
      deleteApiToken: vi.fn(async () => undefined),
    };
    renderManager(client, [existing]);

    expect(screen.getByText("old-cli")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: m.tokensRevoke }));

    await waitFor(() => expect(client.deleteApiToken).toHaveBeenCalledWith("tok-1"));
    await waitFor(() => expect(screen.queryByText("old-cli")).not.toBeInTheDocument());
  });
});
