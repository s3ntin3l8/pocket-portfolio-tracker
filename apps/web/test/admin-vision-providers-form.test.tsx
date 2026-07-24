import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AdminVisionProvider, AdminVisionProvidersResponse } from "@portfolio/api-client";
import { AdminVisionProvidersForm } from "../src/components/admin-vision-providers-form";
import type { AdminVisionProvidersClient } from "../src/components/admin-vision-providers/types";
import messages from "../messages/en.json";

function provider(
  overrides: Partial<AdminVisionProvider> & Pick<AdminVisionProvider, "id" | "label">,
): AdminVisionProvider {
  return {
    configured: true,
    enabled: true,
    priority: 1,
    hasKey: false,
    keyHint: null,
    hasUrl: false,
    keySource: "env",
    ...overrides,
  };
}

function response(providers: AdminVisionProvider[]): AdminVisionProvidersResponse {
  return { providers, encryptionEnabled: true };
}

const PROVIDERS: AdminVisionProvider[] = [
  provider({ id: "claude", label: "Anthropic", priority: 1 }),
  provider({ id: "openai", label: "OpenAI", priority: 2, configured: false, keySource: null }),
  provider({
    id: "ollama",
    label: "Ollama (local)",
    priority: 3,
    configured: false,
    keySource: null,
  }),
];

const STUB_CLIENT: AdminVisionProvidersClient = {
  updateAdminVisionProviders: vi.fn(async () => response(PROVIDERS)),
  setAdminVisionProviderCredential: vi.fn(async () => response(PROVIDERS)),
  clearAdminVisionProviderCredential: vi.fn(async () => response(PROVIDERS)),
};

function renderForm(
  client: AdminVisionProvidersClient,
  onSuccess = vi.fn(),
  opts?: { encryptionEnabled?: boolean; providers?: AdminVisionProvider[] },
) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AdminVisionProvidersForm
        client={client}
        initialProviders={opts?.providers ?? PROVIDERS}
        encryptionEnabled={opts?.encryptionEnabled ?? true}
        onSuccess={onSuccess}
      />
    </NextIntlClientProvider>,
  );
  return onSuccess;
}

describe("AdminVisionProvidersForm", () => {
  it("disables save until something changes", () => {
    renderForm(STUB_CLIENT);
    expect(screen.getByRole("button", { name: messages.Admin.save })).toBeDisabled();
  });

  it("renders one drag handle per row as a single card-row list (not a table)", () => {
    renderForm(STUB_CLIENT);
    expect(screen.getAllByRole("button", { name: messages.Admin.dragHandle })).toHaveLength(
      PROVIDERS.length,
    );
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows a switch for the configured provider and a 'Set API key' pill for unconfigured ones", () => {
    renderForm(STUB_CLIENT);
    expect(screen.getAllByRole("switch", { name: messages.Admin.enabled })).toHaveLength(1);
    // openai + ollama are unconfigured → two pills.
    expect(screen.getAllByRole("button", { name: messages.Admin.credentialSet })).toHaveLength(2);
  });

  it("saves toggled enable state with priorities from display order", async () => {
    const updateAdminVisionProviders = vi.fn(async () =>
      response(PROVIDERS.map((p) => (p.id === "claude" ? { ...p, enabled: false } : p))),
    );
    const client: AdminVisionProvidersClient = { ...STUB_CLIENT, updateAdminVisionProviders };
    const onSuccess = renderForm(client);

    fireEvent.click(screen.getByRole("switch", { name: messages.Admin.enabled }));
    fireEvent.click(screen.getByRole("button", { name: messages.Admin.save }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(updateAdminVisionProviders).toHaveBeenCalledWith([
      { id: "claude", enabled: false, priority: 1 },
      { id: "openai", enabled: true, priority: 2 },
      { id: "ollama", enabled: true, priority: 3 },
    ]);
  });

  it("shows 'encryption disabled' and suppresses every editor — including the URL-based Ollama one", () => {
    // PUT /admin/vision-providers/:id/credential requires encryption.isEnabled
    // unconditionally server-side, even for a URL-only write — so the UI can't offer an
    // editor for Ollama either just because it's not an API key.
    renderForm(STUB_CLIENT, vi.fn(), { encryptionEnabled: false });
    expect(screen.getAllByText(messages.Admin.encryptionDisabled)).toHaveLength(PROVIDERS.length);
    expect(screen.queryByRole("button", { name: messages.Admin.credentialSet })).toBeNull();
    expect(screen.queryByRole("button", { name: messages.Admin.editCredential })).toBeNull();
  });

  it("opens the URL editor for the ollama provider and saves via urlOverride", async () => {
    const setAdminVisionProviderCredential = vi.fn(async () => response(PROVIDERS));
    const client: AdminVisionProvidersClient = {
      ...STUB_CLIENT,
      setAdminVisionProviderCredential,
    };
    renderForm(client, vi.fn(), { encryptionEnabled: true });

    const pills = screen.getAllByRole("button", { name: messages.Admin.credentialSet });
    // openai + ollama are both unconfigured; ollama is the last row.
    fireEvent.click(pills[pills.length - 1]!);
    await waitFor(() => expect(screen.getByText("API key · Ollama (local)")).toBeInTheDocument());

    // URL providers get a `type="url"` input with no show/hide eye toggle, and the editor
    // doesn't claim the value is encrypted at rest (it's stored as plain text).
    const input = screen.getByPlaceholderText(messages.Admin.visionUrlPlaceholder);
    expect(input).toHaveAttribute("type", "url");
    expect(screen.queryByLabelText(messages.Admin.credentialShow)).toBeNull();
    expect(screen.queryByText(messages.Admin.credentialStoredEncrypted)).toBeNull();

    fireEvent.change(input, { target: { value: "http://localhost:11434" } });
    fireEvent.click(screen.getByRole("button", { name: messages.Admin.credentialSave }));

    await waitFor(() =>
      expect(setAdminVisionProviderCredential).toHaveBeenCalledWith("ollama", {
        urlOverride: "http://localhost:11434",
      }),
    );
  });

  it("opens the key editor for a configured provider via the pencil and clears it", async () => {
    const clearAdminVisionProviderCredential = vi.fn(async () => response(PROVIDERS));
    const client: AdminVisionProvidersClient = {
      ...STUB_CLIENT,
      clearAdminVisionProviderCredential,
    };
    const providers: AdminVisionProvider[] = [
      provider({
        id: "claude",
        label: "Anthropic",
        priority: 1,
        hasKey: true,
        keyHint: "••••abcd",
        keySource: "db",
      }),
    ];
    renderForm(client, vi.fn(), { providers });

    fireEvent.click(screen.getByRole("button", { name: messages.Admin.editCredential }));
    await waitFor(() => expect(screen.getByText("API key · Anthropic")).toBeInTheDocument());
    expect(screen.getByText("••••abcd")).toBeInTheDocument();
    // Unlike Ollama's URL editor, an API-key editor does claim encryption at rest.
    expect(screen.getByText(messages.Admin.credentialStoredEncrypted)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: messages.Admin.credentialClear }));

    await waitFor(() => expect(clearAdminVisionProviderCredential).toHaveBeenCalledWith("claude"));
  });
});
