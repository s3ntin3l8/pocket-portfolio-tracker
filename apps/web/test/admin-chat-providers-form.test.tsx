import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AdminChatProvider, AdminChatProvidersResponse } from "@portfolio/api-client";
import {
  AdminChatProvidersForm,
  type AdminChatProvidersClient,
} from "../src/components/admin-chat-providers-form";
import messages from "../messages/en.json";

function provider(over: Partial<AdminChatProvider> & Pick<AdminChatProvider, "id" | "label">) {
  return {
    configured: true,
    enabled: true,
    enabledSource: "vision",
    priority: 1,
    prioritySource: "vision",
    model: null,
    modelSource: null,
    modelEnvVar: "X_CHAT_MODEL",
    ...over,
  } satisfies AdminChatProvider;
}

const VIEW: AdminChatProvidersResponse = {
  providers: [
    provider({
      id: "claude",
      label: "Claude",
      model: "claude-opus-5-5",
      modelSource: "default",
      modelEnvVar: "ANTHROPIC_CHAT_MODEL",
    }),
    provider({
      id: "openrouter",
      label: "OpenRouter",
      model: "env/model",
      modelSource: "env",
      priority: 2,
      modelEnvVar: "OPENROUTER_CHAT_MODEL",
    }),
    provider({ id: "ollama", label: "Ollama", configured: false, priority: 3 }),
  ],
  pinned: null,
  pinnedSource: null,
  activeProvider: "claude",
};

function setup(over: Partial<AdminChatProvidersClient> = {}, initial = VIEW) {
  const client: AdminChatProvidersClient = {
    updateAdminChatProviders: vi.fn(async () => initial),
    resetAdminChatProviders: vi.fn(async () => initial),
    ...over,
  };
  const onSuccess = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AdminChatProvidersForm client={client} initial={initial} onSuccess={onSuccess} />
    </NextIntlClientProvider>,
  );
  return { client, onSuccess };
}
const A = messages.Admin;

describe("AdminChatProvidersForm", () => {
  it("shows which provider answers now, with its model", () => {
    setup();
    expect(screen.getByTestId("chat-active")).toHaveTextContent("Claude");
    expect(screen.getByTestId("chat-active")).toHaveTextContent("claude-opus-5-5");
  });

  it("says so when no provider can answer", () => {
    setup({}, { ...VIEW, activeProvider: null });
    expect(screen.getByTestId("chat-active")).toHaveTextContent(A.chatNoneActive);
  });

  it("shows inherited models as placeholders (env var named) and flags unconfigured providers", () => {
    setup();
    expect(
      screen.getByLabelText(A.chatModel, { selector: "#chat-model-openrouter" }),
    ).toHaveProperty("placeholder", "Default: env/model (from OPENROUTER_CHAT_MODEL)");
    expect(screen.getByLabelText(A.chatModel, { selector: "#chat-model-ollama" })).toHaveProperty(
      "placeholder",
      A.chatModelRequired,
    );
    expect(screen.getByText(A.chatNotConfigured)).toBeInTheDocument();
    expect(screen.getByText(A.chatInherited)).toBeInTheDocument();
  });

  it("keeps save disabled until something changes", () => {
    setup();
    expect(screen.getByRole("button", { name: A.save })).toBeDisabled();
  });

  it("saves explicit order, enabled flags, models and the pin", async () => {
    const { client, onSuccess } = setup();
    fireEvent.change(screen.getByLabelText(A.chatModel, { selector: "#chat-model-ollama" }), {
      target: { value: " qwen3 " },
    });
    fireEvent.click(screen.getByRole("button", { name: `${A.chatMoveDown}: Claude` }));
    fireEvent.click(screen.getByRole("switch", { name: `${A.enabled}: OpenRouter` }));
    fireEvent.change(screen.getByLabelText(A.chatPin), { target: { value: "ollama" } });
    fireEvent.click(screen.getByRole("button", { name: A.save }));

    await waitFor(() =>
      expect(client.updateAdminChatProviders).toHaveBeenCalledWith({
        providers: [
          { id: "openrouter", enabled: false, priority: 1, model: null },
          { id: "claude", enabled: true, priority: 2, model: null },
          { id: "ollama", enabled: true, priority: 3, model: "qwen3" },
        ],
        pinned: "ollama",
      }),
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(await screen.findByText(A.saved)).toBeInTheDocument();
  });

  it("disables the first up and last down arrows", () => {
    setup();
    expect(screen.getByRole("button", { name: `${A.chatMoveUp}: Claude` })).toBeDisabled();
    expect(screen.getByRole("button", { name: `${A.chatMoveDown}: Ollama` })).toBeDisabled();
  });

  it("notes an env pin without treating it as a value saved here", () => {
    setup({}, { ...VIEW, pinned: "claude", pinnedSource: "env" });
    expect(screen.getByText(A.chatPinFromEnv)).toBeInTheDocument();
    expect(screen.getByLabelText(A.chatPin)).toHaveValue("");
  });

  it("preselects a pin that was saved here", () => {
    setup({}, { ...VIEW, pinned: "ollama", pinnedSource: "db" });
    expect(screen.getByLabelText(A.chatPin)).toHaveValue("ollama");
  });

  it("shows an error when saving fails and keeps the draft", async () => {
    setup({
      updateAdminChatProviders: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    fireEvent.click(screen.getByRole("switch", { name: `${A.enabled}: Claude` }));
    fireEvent.click(screen.getByRole("button", { name: A.save }));
    expect(await screen.findByRole("alert")).toHaveTextContent(A.updateError);
    expect(screen.getByRole("button", { name: A.save })).not.toBeDisabled();
  });

  it("resets to the inherited defaults", async () => {
    const reset: AdminChatProvidersResponse = { ...VIEW, pinned: null };
    const { client, onSuccess } = setup({ resetAdminChatProviders: vi.fn(async () => reset) });
    fireEvent.click(screen.getByRole("button", { name: A.chatReset }));
    await waitFor(() => expect(client.resetAdminChatProviders).toHaveBeenCalled());
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(await screen.findByText(A.chatResetDone)).toBeInTheDocument();
  });
});
