import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import {
  AdminImportSettingsForm,
  type AdminImportSettingsClient,
} from "../src/components/admin-import-settings-form";
import messages from "../messages/en.json";

const m = messages.Admin;

function renderForm(
  client: AdminImportSettingsClient,
  initialStrategy: "parser_first" | "vision_only" = "parser_first",
  onSuccess = vi.fn(),
) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AdminImportSettingsForm
        client={client}
        initialStrategy={initialStrategy}
        onSuccess={onSuccess}
      />
    </NextIntlClientProvider>,
  );
  return onSuccess;
}

const PARSER = /Deterministic parser first/;
const VISION = /Always use vision AI/;

describe("AdminImportSettingsForm", () => {
  it("reflects the initial strategy and offers both selectable options, as a single card (not two)", () => {
    renderForm({ updateAdminImportSettings: vi.fn() }, "vision_only");
    const parser = screen.getByRole("radio", { name: PARSER });
    const vision = screen.getByRole("radio", { name: VISION });
    expect(vision).toHaveAttribute("aria-checked", "true");
    expect(parser).toHaveAttribute("aria-checked", "false");
    // Both radios live in the same radiogroup card.
    expect(parser.closest('[role="radiogroup"]')).toBe(vision.closest('[role="radiogroup"]'));
  });

  it("saves immediately on selection — no separate Save button", async () => {
    const client: AdminImportSettingsClient = {
      updateAdminImportSettings: vi.fn(async () => ({ strategy: "vision_only" as const })),
    };
    const onSuccess = renderForm(client, "parser_first");

    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: VISION }));
    // Optimistic: reflects immediately, before the request resolves.
    expect(screen.getByRole("radio", { name: VISION })).toHaveAttribute("aria-checked", "true");

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(client.updateAdminImportSettings).toHaveBeenCalledWith({
      strategy: "vision_only",
    });
  });

  it("rolls back the optimistic selection and shows an error when saving fails", async () => {
    const client: AdminImportSettingsClient = {
      updateAdminImportSettings: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    renderForm(client, "parser_first");

    fireEvent.click(screen.getByRole("radio", { name: VISION }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(m.importStrategyError));
    // Rolled back to the last-saved strategy.
    expect(screen.getByRole("radio", { name: PARSER })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: VISION })).toHaveAttribute("aria-checked", "false");
  });

  it("ignores clicking the already-selected option", () => {
    const client: AdminImportSettingsClient = {
      updateAdminImportSettings: vi.fn(),
    };
    renderForm(client, "parser_first");

    fireEvent.click(screen.getByRole("radio", { name: PARSER }));
    expect(client.updateAdminImportSettings).not.toHaveBeenCalled();
  });
});
