import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AdminProvider, AdminProvidersResponse } from "@portfolio/api-client";
import {
  AdminProvidersForm,
  type AdminProvidersClient,
} from "../src/components/admin-providers-form";
import messages from "../messages/en.json";

/** Minimal AdminProvider fixture (no DB credential set). */
function provider(
  overrides: Partial<AdminProvider> & Pick<AdminProvider, "id" | "label">,
): AdminProvider {
  return {
    configured: true,
    enabled: true,
    priority: 1,
    hasKey: false,
    keyHint: null,
    hasUrl: false,
    keySource: null,
    ...overrides,
  };
}

/** A stub AdminProvidersResponse wrapping a list of providers. */
function response(providers: AdminProvider[]): AdminProvidersResponse {
  return { providers, encryptionEnabled: false };
}

const PROVIDERS: AdminProvider[] = [
  provider({ id: "twelvedata", label: "Twelve Data", priority: 1 }),
  provider({ id: "yahoo", label: "Yahoo Finance", priority: 2 }),
  provider({ id: "eodhd", label: "EODHD", configured: false, priority: 3 }),
];

const STUB_CLIENT: AdminProvidersClient = {
  updateAdminProviders: vi.fn(async () => response(PROVIDERS)),
  setAdminProviderCredential: vi.fn(async () => response(PROVIDERS)),
  clearAdminProviderCredential: vi.fn(async () => response(PROVIDERS)),
};

function renderForm(
  client: AdminProvidersClient,
  onSuccess = vi.fn(),
  opts?: { encryptionEnabled?: boolean; providers?: AdminProvider[] },
) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AdminProvidersForm
        client={client}
        initialProviders={opts?.providers ?? PROVIDERS}
        encryptionEnabled={opts?.encryptionEnabled ?? false}
        onSuccess={onSuccess}
      />
    </NextIntlClientProvider>,
  );
  return onSuccess;
}

describe("AdminProvidersForm", () => {
  it("disables save until something changes", () => {
    renderForm(STUB_CLIENT);
    expect(screen.getByRole("button", { name: messages.Admin.save })).toBeDisabled();
  });

  it("renders one drag handle per provider row, as a single card-row list (not a table)", () => {
    renderForm(STUB_CLIENT);
    const handles = screen.getAllByRole("button", { name: messages.Admin.dragHandle });
    expect(handles).toHaveLength(PROVIDERS.length);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders a switch for each configured provider, and a 'Set API key' pill for an unconfigured one", () => {
    renderForm(STUB_CLIENT, vi.fn(), { encryptionEnabled: true });
    // twelvedata + yahoo are configured → two switches.
    const enabledSwitches = screen.getAllByRole("switch", { name: messages.Admin.enabled });
    expect(enabledSwitches).toHaveLength(2);
    // eodhd is unconfigured → a "Set API key" pill instead of a switch.
    expect(screen.getByRole("button", { name: messages.Admin.credentialSet })).toBeInTheDocument();
  });

  it("saves toggled enable state with priorities from display order", async () => {
    const updateAdminProviders = vi.fn(async () =>
      response(PROVIDERS.map((p) => (p.id === "yahoo" ? { ...p, enabled: false } : p))),
    );
    const client: AdminProvidersClient = {
      ...STUB_CLIENT,
      updateAdminProviders,
    };
    const onSuccess = renderForm(client);

    // Disable Yahoo — its switch has aria-label "Enabled" (second enabled row).
    const enabledSwitches = screen.getAllByRole("switch", { name: messages.Admin.enabled });
    fireEvent.click(enabledSwitches[1]);
    fireEvent.click(screen.getByRole("button", { name: messages.Admin.save }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(updateAdminProviders).toHaveBeenCalledWith([
      { id: "twelvedata", enabled: true, priority: 1 },
      { id: "yahoo", enabled: false, priority: 2 },
      { id: "eodhd", enabled: true, priority: 3 },
    ]);
  });

  it("renders a 'from .env' key hint for an env-keyed provider with no DB key", () => {
    const providers: AdminProvider[] = [
      provider({ id: "twelvedata", label: "Twelve Data", priority: 1, keySource: "env" }),
      provider({ id: "yahoo", label: "Yahoo Finance", priority: 2, keySource: null }),
    ];
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AdminProvidersForm client={STUB_CLIENT} initialProviders={providers} encryptionEnabled />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(messages.Admin.keyFromEnv)).toBeInTheDocument();
  });

  it("shows usage: live quota with a limit and a local-count fallback", () => {
    const withUsage: AdminProvider[] = [
      provider({
        id: "twelvedata",
        label: "Twelve Data",
        priority: 1,
        keySource: "env",
        usage: { source: "provider", window: "day", used: 120, limit: 800 },
      }),
      provider({
        id: "antam",
        label: "Antam buyback",
        priority: 2,
        keySource: null,
        usage: { source: "local", window: "month", used: 5, limit: null },
      }),
    ];
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AdminProvidersForm client={STUB_CLIENT} initialProviders={withUsage} encryptionEnabled />
      </NextIntlClientProvider>,
    );
    // "from .env · 120 / 800 today" — key text and usage share one sub-line.
    expect(screen.getByText("120 / 800 today")).toBeInTheDocument();
    expect(screen.getByText(`5 this month (${messages.Admin.usageLocalHint})`)).toBeInTheDocument();
  });

  it("shows 'encryption disabled' hint when encryptionEnabled=false, and suppresses the editor", () => {
    renderForm(STUB_CLIENT);
    const hints = screen.getAllByText(messages.Admin.encryptionDisabled);
    expect(hints.length).toBeGreaterThan(0);
    // No pencil, no "Set API key" pill anywhere while encryption is off.
    expect(screen.queryByRole("button", { name: messages.Admin.editCredential })).toBeNull();
    expect(screen.queryByRole("button", { name: messages.Admin.credentialSet })).toBeNull();
  });

  it("shows '—' usage cell when usage is null", () => {
    const providers: AdminProvider[] = [
      provider({ id: "yahoo", label: "Yahoo Finance", priority: 1, usage: null }),
    ];
    renderForm(STUB_CLIENT, vi.fn(), { providers });
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows 'Not needed' for a keyless provider, with no editor offered", () => {
    const providers: AdminProvider[] = [
      provider({
        id: "yahoo",
        label: "Yahoo Finance",
        priority: 1,
        keySource: null,
        hasKey: false,
      }),
    ];
    renderForm(STUB_CLIENT, vi.fn(), { providers, encryptionEnabled: true });
    expect(screen.getByText(messages.Admin.keyNotNeeded)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: messages.Admin.editCredential })).toBeNull();
  });

  it("shows 'none' for a key-requiring provider with no key set", () => {
    const providers: AdminProvider[] = [
      provider({
        id: "eodhd",
        label: "EODHD",
        priority: 1,
        keySource: null,
        hasKey: false,
        configured: false,
      }),
    ];
    renderForm(STUB_CLIENT, vi.fn(), { providers, encryptionEnabled: true });
    expect(screen.getByText(messages.Admin.keyNone)).toBeInTheDocument();
  });

  it("shows 'Not needed' even when encryption is disabled (no key to encrypt)", () => {
    const providers: AdminProvider[] = [
      provider({
        id: "yahoo",
        label: "Yahoo Finance",
        priority: 1,
        keySource: null,
        hasKey: false,
      }),
    ];
    renderForm(STUB_CLIENT, vi.fn(), { providers, encryptionEnabled: false });
    expect(screen.getByText(messages.Admin.keyNotNeeded)).toBeInTheDocument();
    expect(screen.queryByText(messages.Admin.encryptionDisabled)).toBeNull();
  });

  it("shows masked key hint for a provider with a DB key when encryption is enabled", () => {
    const providers: AdminProvider[] = [
      provider({
        id: "twelvedata",
        label: "Twelve Data",
        priority: 1,
        hasKey: true,
        keyHint: "••••abcd",
        keySource: "db",
      }),
    ];
    renderForm(STUB_CLIENT, vi.fn(), { providers, encryptionEnabled: true });
    expect(screen.getByText("••••abcd")).toBeInTheDocument();
  });

  it("shows 'from .env' for an env-keyed provider when encryption is enabled", () => {
    const providers: AdminProvider[] = [
      provider({
        id: "twelvedata",
        label: "Twelve Data",
        priority: 1,
        keySource: "env",
        hasKey: false,
      }),
    ];
    renderForm(STUB_CLIENT, vi.fn(), { providers, encryptionEnabled: true });
    expect(screen.getByText(messages.Admin.keyFromEnv)).toBeInTheDocument();
  });

  it("opens the inline editor via the 'Set API key' pill and saves via setAdminProviderCredential", async () => {
    const setAdminProviderCredential = vi.fn(async () => ({
      providers: PROVIDERS,
      encryptionEnabled: true,
    }));
    const client: AdminProvidersClient = { ...STUB_CLIENT, setAdminProviderCredential };
    // A key-requiring provider with no key yet (configured:false) → shows the pill.
    const providers: AdminProvider[] = [
      provider({
        id: "twelvedata",
        label: "Twelve Data",
        priority: 1,
        keySource: null,
        configured: false,
      }),
    ];
    renderForm(client, vi.fn(), { providers, encryptionEnabled: true });

    fireEvent.click(screen.getByRole("button", { name: messages.Admin.credentialSet }));

    // The inline editor's label ("API key · {label}") confirms it expanded.
    await waitFor(() => expect(screen.getByText("API key · Twelve Data")).toBeInTheDocument());

    const input = screen.getByPlaceholderText(messages.Admin.credentialPlaceholder);
    fireEvent.change(input, { target: { value: "sk-test-1234" } });
    fireEvent.click(screen.getByRole("button", { name: messages.Admin.credentialSave }));

    await waitFor(() =>
      expect(setAdminProviderCredential).toHaveBeenCalledWith("twelvedata", {
        apiKey: "sk-test-1234",
      }),
    );
  });

  it("opens the inline editor via the pencil for a configured provider and clears the key", async () => {
    const clearAdminProviderCredential = vi.fn(async () => ({
      providers: PROVIDERS,
      encryptionEnabled: true,
    }));
    const client: AdminProvidersClient = { ...STUB_CLIENT, clearAdminProviderCredential };
    const providers: AdminProvider[] = [
      provider({
        id: "twelvedata",
        label: "Twelve Data",
        priority: 1,
        hasKey: true,
        keyHint: "••••abcd",
        keySource: "db",
      }),
    ];
    renderForm(client, vi.fn(), { providers, encryptionEnabled: true });

    fireEvent.click(screen.getByRole("button", { name: messages.Admin.editCredential }));
    await waitFor(() => expect(screen.getByText("API key · Twelve Data")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: messages.Admin.credentialClear }));

    await waitFor(() => expect(clearAdminProviderCredential).toHaveBeenCalledWith("twelvedata"));
  });

  it("only draws the mobile trailing grip once 'Reorder' is toggled", () => {
    renderForm(STUB_CLIENT);
    // Just the lead (desktop) grip per row before entering reorder mode.
    expect(screen.getAllByRole("button", { name: messages.Admin.dragHandle })).toHaveLength(
      PROVIDERS.length,
    );
    fireEvent.click(screen.getByRole("button", { name: messages.Admin.reorder }));
    // Now each row has both the lead and the trailing grip.
    expect(screen.getAllByRole("button", { name: messages.Admin.dragHandle })).toHaveLength(
      PROVIDERS.length * 2,
    );
    expect(screen.getByRole("button", { name: messages.Admin.done })).toBeInTheDocument();
  });
});
