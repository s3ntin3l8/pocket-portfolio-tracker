import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type {
  AdminAiConnection,
  AdminAiModel,
  AdminAiResponse,
  AdminAiTask,
} from "@portfolio/api-client";
import { AdminAiForm } from "../src/components/admin-ai-form";
import type { AdminAiClient } from "../src/components/admin-ai/types";
import messages from "../messages/en.json";

function conn(over: Partial<AdminAiConnection> & Pick<AdminAiConnection, "id" | "label">) {
  return {
    credential: "key",
    configured: false,
    hasKey: false,
    keyHint: null,
    hasUrl: false,
    keySource: null,
    local: null,
    allowDataCollection: null,
    ...over,
  } satisfies AdminAiConnection;
}

const CONNECTIONS: AdminAiConnection[] = [
  conn({
    id: "claude",
    label: "Claude (Anthropic)",
    configured: true,
    hasKey: true,
    keyHint: "••••abcd",
    keySource: "db",
  }),
  conn({ id: "gemini", label: "Gemini (Google)" }),
  conn({ id: "openrouter", label: "OpenRouter", configured: true, keySource: "env" }),
  conn({
    id: "ollama",
    label: "Ollama (local)",
    credential: "url",
    configured: true,
    hasUrl: true,
    keySource: "db",
    local: true,
  }),
];

const task = (t: "vision" | "chat", over: Partial<AdminAiTask> = {}): AdminAiTask => ({
  task: t,
  provider: null,
  model: null,
  effort: null,
  usable: false,
  ...over,
});

const view = (over: Partial<AdminAiResponse> = {}): AdminAiResponse => ({
  connections: CONNECTIONS,
  tasks: [
    task("vision", { provider: "claude", model: "claude-sonnet-4-6", usable: true }),
    task("chat"),
  ],
  encryptionEnabled: true,
  ...over,
});

const MODELS: AdminAiModel[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", vision: true, tools: true },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", vision: true, tools: true },
  { id: "claude-new", label: "Claude New", vision: null, tools: true },
];

function makeClient(over: Partial<AdminAiClient> = {}): AdminAiClient {
  return {
    listAdminAiModels: vi.fn(async () => ({ models: MODELS })),
    updateAdminAiTask: vi.fn(async () => view()),
    updateAdminAiProvider: vi.fn(async () => view()),
    setAdminAiCredential: vi.fn(async () => view()),
    clearAdminAiCredential: vi.fn(async () => view()),
    ...over,
  };
}

function renderForm(client: AdminAiClient, initial: AdminAiResponse = view(), onSuccess = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AdminAiForm client={client} initial={initial} onSuccess={onSuccess} />
    </NextIntlClientProvider>,
  );
  return onSuccess;
}

const card = (t: "vision" | "chat") => within(screen.getByTestId(`ai-task-${t}`));

/** Open a card's model dropdown. */
async function openModels(t: "vision" | "chat") {
  fireEvent.click(card(t).getByRole("combobox", { name: "Model" }));
  return screen.findByRole("listbox");
}

describe("AdminAiForm · tasks", () => {
  it("shows each task's current provider and model, and offers only connected providers", () => {
    renderForm(makeClient());
    const provider = card("vision").getByLabelText("Provider") as HTMLSelectElement;
    expect(provider.value).toBe("claude");
    expect(card("vision").getByRole("combobox", { name: "Model" })).toHaveTextContent(
      "claude-sonnet-4-6",
    );
    const options = within(provider)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual(["Off", "Claude (Anthropic)", "OpenRouter", "Ollama (local)"]); // no Gemini
    expect((card("chat").getByLabelText("Provider") as HTMLSelectElement).value).toBe("");
    expect(card("chat").getByText("Switched off.")).toBeInTheDocument();
  });

  it("picking a provider clears the model, loads that provider's models and saves the choice", async () => {
    const client = makeClient({
      updateAdminAiTask: vi.fn(async () =>
        view({
          tasks: [
            task("vision", { provider: "claude", model: "claude-sonnet-4-6", usable: true }),
            task("chat", { provider: "claude", model: "claude-opus-5-5", usable: true }),
          ],
        }),
      ),
    });
    const onSuccess = renderForm(client);

    fireEvent.change(card("chat").getByLabelText("Provider"), { target: { value: "claude" } });
    await waitFor(() => expect(client.listAdminAiModels).toHaveBeenCalledWith("claude", "chat"));
    const save = card("chat").getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled(); // a provider needs a model

    const list = await openModels("chat");
    fireEvent.click(within(list).getByText("Claude Opus 5.5"));
    expect(card("chat").getByRole("combobox", { name: "Model" })).toHaveTextContent(
      "claude-opus-5-5",
    );

    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() =>
      expect(client.updateAdminAiTask).toHaveBeenCalledWith("chat", {
        provider: "claude",
        model: "claude-opus-5-5",
        effort: null,
      }),
    );
    expect(await card("chat").findByText("Saved")).toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalled();
  });

  it("filters the dropdown as you type and marks models whose capability the provider doesn't state", async () => {
    renderForm(makeClient());
    const list = await openModels("vision");
    expect(within(list).getAllByText("unverified")).toHaveLength(1); // Claude New: vision unknown
    fireEvent.change(screen.getByPlaceholderText("Search or type a model id"), {
      target: { value: "opus" },
    });
    expect(within(list).getByText("Claude Opus 5.5")).toBeInTheDocument();
    expect(within(list).queryByText("Claude Sonnet 4.6")).not.toBeInTheDocument();
  });

  it("keeps the saved model selectable when the provider's list no longer has it", async () => {
    renderForm(
      makeClient({ listAdminAiModels: vi.fn(async () => ({ models: [MODELS[0]!] })) }),
      view({
        tasks: [
          task("vision", { provider: "claude", model: "claude-retired", usable: true }),
          task("chat"),
        ],
      }),
    );
    const list = await openModels("vision");
    expect(within(list).getByText("claude-retired")).toBeInTheDocument();
    expect(card("vision").getByRole("combobox", { name: "Model" })).toHaveTextContent(
      "claude-retired",
    );
  });

  it("falls back to typing a model id when the list fails", async () => {
    const client = makeClient({
      listAdminAiModels: vi.fn(async () => ({ models: [], error: "provider_http_401" })),
    });
    renderForm(client);
    fireEvent.change(card("chat").getByLabelText("Provider"), { target: { value: "openrouter" } });
    const list = await openModels("chat");
    expect(within(list).getByText(/Couldn't load the model list/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search or type a model id"), {
      target: { value: "vendor/custom-model" },
    });
    fireEvent.click(within(list).getByText("Use “vendor/custom-model”"));
    fireEvent.click(card("chat").getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(client.updateAdminAiTask).toHaveBeenCalledWith("chat", {
        provider: "openrouter",
        model: "vendor/custom-model",
        effort: null,
      }),
    );
  });

  it("offers reasoning effort for Claude chat only, and sends it", async () => {
    const client = makeClient();
    renderForm(client);
    expect(card("vision").queryByLabelText("Reasoning effort")).not.toBeInTheDocument();

    fireEvent.change(card("chat").getByLabelText("Provider"), { target: { value: "openrouter" } });
    expect(card("chat").queryByLabelText("Reasoning effort")).not.toBeInTheDocument();
    fireEvent.change(card("chat").getByLabelText("Provider"), { target: { value: "claude" } });
    fireEvent.change(card("chat").getByLabelText("Reasoning effort"), {
      target: { value: "high" },
    });
    fireEvent.click(within(await openModels("chat")).getByText("Claude Opus 5.5"));
    fireEvent.click(card("chat").getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(client.updateAdminAiTask).toHaveBeenCalledWith("chat", {
        provider: "claude",
        model: "claude-opus-5-5",
        effort: "high",
      }),
    );
  });

  it("switches a task off", async () => {
    const client = makeClient();
    renderForm(client);
    fireEvent.change(card("vision").getByLabelText("Provider"), { target: { value: "" } });
    fireEvent.click(card("vision").getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(client.updateAdminAiTask).toHaveBeenCalledWith("vision", {
        provider: null,
        model: null,
        effort: null,
      }),
    );
  });

  it("states where data goes: a cloud provider, or your own network", () => {
    renderForm(
      makeClient(),
      view({
        tasks: [
          task("vision", { provider: "claude", model: "m", usable: true }),
          task("chat", { provider: "ollama", model: "qwen3", usable: true }),
        ],
      }),
    );
    expect(card("vision").getByText(/sent to Claude \(Anthropic\)/)).toBeInTheDocument();
    expect(
      card("chat").getByText("Portfolio figures stay on your own network."),
    ).toBeInTheDocument();
  });

  it("warns when the chosen provider is no longer connected", () => {
    renderForm(
      makeClient(),
      view({
        connections: CONNECTIONS.map((c) =>
          c.id === "claude" ? { ...c, configured: false, hasKey: false, keySource: null } : c,
        ),
        tasks: [task("vision", { provider: "claude", model: "m", usable: false }), task("chat")],
      }),
    );
    expect(card("vision").getByText(/no longer connected/)).toHaveAttribute("role", "status");
    const options = within(card("vision").getByLabelText("Provider")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toContain("Claude (Anthropic) (not connected)");
  });

  it("shows a save failure and keeps the draft", async () => {
    const client = makeClient({
      updateAdminAiTask: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    renderForm(client);
    fireEvent.change(card("vision").getByLabelText("Provider"), { target: { value: "" } });
    fireEvent.click(card("vision").getByRole("button", { name: "Save changes" }));
    expect(
      await card("vision").findByText("Couldn't save changes. Please try again."),
    ).toBeInTheDocument();
    expect((card("vision").getByLabelText("Provider") as HTMLSelectElement).value).toBe("");
  });
});

describe("AdminAiForm · connections", () => {
  const connections = () => within(screen.getByRole("region", { name: "Connections" }));

  it("shows key state without secrets, and Ollama's locality", () => {
    renderForm(makeClient());
    expect(connections().getByText("••••abcd")).toBeInTheDocument();
    expect(connections().getAllByText("from .env")).toHaveLength(1); // OpenRouter via env
    expect(connections().getByText("URL set")).toBeInTheDocument();
    expect(connections().getByText("Stays on your network")).toBeInTheDocument();
  });

  it("saves a key for an unconnected provider and refreshes both tasks' provider lists", async () => {
    const client = makeClient({
      setAdminAiCredential: vi.fn(async () =>
        view({
          connections: CONNECTIONS.map((c) =>
            c.id === "gemini"
              ? {
                  ...c,
                  configured: true,
                  hasKey: true,
                  keyHint: "••••9999",
                  keySource: "db" as const,
                }
              : c,
          ),
        }),
      ),
    });
    renderForm(client);
    fireEvent.click(connections().getByRole("button", { name: "Set API key" }));
    fireEvent.change(screen.getByLabelText("API key · Gemini (Google)"), {
      target: { value: "AIza-test-9999" }, // pragma: allowlist secret
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(client.setAdminAiCredential).toHaveBeenCalledWith("gemini", {
        apiKey: "AIza-test-9999", // pragma: allowlist secret
      }),
    );
    expect(await connections().findByText("••••9999")).toBeInTheDocument();
    const options = within(card("chat").getByLabelText("Provider")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toContain("Gemini (Google)");
  });

  it("saves Ollama's URL as a URL, and can clear a stored key", async () => {
    const client = makeClient();
    renderForm(client);
    fireEvent.click(connections().getByRole("button", { name: "Edit API key: Ollama (local)" }));
    fireEvent.change(screen.getByLabelText("API key · Ollama (local)"), {
      target: { value: "http://ollama:11434" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(client.setAdminAiCredential).toHaveBeenCalledWith("ollama", {
        urlOverride: "http://ollama:11434",
      }),
    );

    fireEvent.click(
      connections().getByRole("button", { name: "Edit API key: Claude (Anthropic)" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear key" }));
    await waitFor(() => expect(client.clearAdminAiCredential).toHaveBeenCalledWith("claude"));
  });

  it("without server-side encryption, credentials can't be edited but tasks still can", () => {
    renderForm(makeClient(), view({ encryptionEnabled: false }));
    expect(connections().queryByRole("button", { name: "Set API key" })).not.toBeInTheDocument();
    expect(connections().queryByRole("button", { name: /Edit API key/ })).not.toBeInTheDocument();
    expect(connections().getAllByText(/DB_ENCRYPTION_KEY/).length).toBeGreaterThan(0);
    expect(card("vision").getByLabelText("Provider")).toBeEnabled();
  });

  it("tests a connection: success and failure", async () => {
    // The vision card loads its own model list on mount; only the Test button asks for "chat".
    const listAdminAiModels = vi.fn(async (id: string, t: "vision" | "chat") =>
      id === "openrouter" && t === "chat"
        ? { models: [], error: "provider_http_401" }
        : { models: MODELS },
    );
    renderForm(makeClient({ listAdminAiModels }));
    const tests = connections().getAllByRole("button", { name: "Test" });
    fireEvent.click(tests[0]!);
    expect(await connections().findByText("Connected.")).toBeInTheDocument();
    fireEvent.click(tests[1]!);
    expect(
      await connections().findByText("Couldn't connect (provider_http_401)."),
    ).toBeInTheDocument();
  });

  it("toggles OpenRouter's data-collection option", async () => {
    const client = makeClient();
    renderForm(client);
    fireEvent.click(
      connections().getByRole("switch", { name: "Allow providers that may retain prompts" }),
    );
    await waitFor(() =>
      expect(client.updateAdminAiProvider).toHaveBeenCalledWith("openrouter", {
        allowDataCollection: true,
      }),
    );
  });
});
