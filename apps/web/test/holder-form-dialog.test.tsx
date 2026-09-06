import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AccountHolder } from "@portfolio/api-client";
import messages from "../messages/en.json";
import { Button } from "@/components/ui/button";
import { HolderFormDialog } from "@/components/holder-form-dialog";

const refresh = vi.fn();
const createAccountHolder = vi.fn(
  async (): Promise<AccountHolder> =>
    ({
      id: "h-new",
      userId: "u1",
      name: "Emma",
      type: "self",
      birthYear: null,
      taxAllowanceAnnual: null,
      capitalGainsTaxRate: null,
      churchTax: false,
      taxResidence: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    }) as AccountHolder,
);
const updateAccountHolder = vi.fn(async () => ({}) as never);
const deleteAccountHolder = vi.fn(async () => undefined);

vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/api", () => ({
  useApiClient: () => ({ createAccountHolder, updateAccountHolder, deleteAccountHolder }),
}));

const t = messages.AccountHolders;
const tf = messages.PortfolioForm;

function renderCreate() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <HolderFormDialog mode="create" trigger={<Button>{t.add}</Button>} />
    </NextIntlClientProvider>,
  );
}

function renderEdit(
  holder: AccountHolder = {
    id: "h1",
    userId: "u1",
    name: "Emma",
    type: "child",
    birthYear: 2017,
    taxAllowanceAnnual: null,
    capitalGainsTaxRate: null,
    churchTax: false,
    taxResidence: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <HolderFormDialog mode="edit" holder={holder} trigger={<Button>Edit</Button>} />
    </NextIntlClientProvider>,
  );
}

describe("HolderFormDialog", () => {
  beforeEach(() => {
    refresh.mockClear();
    createAccountHolder.mockClear();
    updateAccountHolder.mockClear();
    deleteAccountHolder.mockClear();
  });

  it("creates a holder with the entered name and type", async () => {
    renderCreate();
    fireEvent.click(screen.getByRole("button", { name: t.add }));

    fireEvent.change(screen.getByLabelText(tf.holderName), { target: { value: "Emma" } });
    fireEvent.click(screen.getByRole("button", { name: t.add }));

    await waitFor(() => expect(createAccountHolder).toHaveBeenCalled());
    expect(createAccountHolder).toHaveBeenCalledWith({
      name: "Emma",
      type: "self",
      birthYear: null,
      taxAllowanceAnnual: null,
      capitalGainsTaxRate: null,
      churchTax: false,
      taxResidence: null,
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("captures birth year and the optional DE tax profile fields", async () => {
    renderCreate();
    fireEvent.click(screen.getByRole("button", { name: t.add }));

    fireEvent.change(screen.getByLabelText(tf.holderName), { target: { value: "Emma" } });
    fireEvent.change(screen.getByLabelText(tf.birthYear), { target: { value: "2017" } });
    fireEvent.click(screen.getByText(t.taxProfileSection));
    fireEvent.change(screen.getByLabelText(t.taxResidence), { target: { value: "de" } });
    // The trigger and the footer's submit button share the "Add holder" name — disambiguate
    // by type, same as the "keeps the primary button in the footer" test below.
    const submitBtn = screen
      .getAllByRole("button", { name: t.add })
      .find((b) => b.getAttribute("type") === "submit");
    fireEvent.click(submitBtn!);

    await waitFor(() => expect(createAccountHolder).toHaveBeenCalled());
    expect(createAccountHolder).toHaveBeenCalledWith(
      expect.objectContaining({ birthYear: 2017, taxResidence: "DE" }),
    );
  });

  it("edits an existing holder via update", async () => {
    renderEdit();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    fireEvent.change(screen.getByLabelText(tf.holderName), { target: { value: "Emma R." } });
    fireEvent.click(screen.getByRole("button", { name: tf.save }));

    await waitFor(() => expect(updateAccountHolder).toHaveBeenCalledWith("h1", expect.any(Object)));
    expect(updateAccountHolder).toHaveBeenCalledWith(
      "h1",
      expect.objectContaining({ name: "Emma R." }),
    );
  });

  it("deletes only after the two-step confirm", async () => {
    renderEdit();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    fireEvent.click(screen.getByRole("button", { name: t.delete }));
    expect(deleteAccountHolder).not.toHaveBeenCalled();

    const confirmBtn = await screen.findByRole("button", { name: t.confirmDelete });
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(deleteAccountHolder).toHaveBeenCalledWith("h1"));
    expect(refresh).toHaveBeenCalled();
  });

  describe("overlay chrome (#625 migration)", () => {
    it("renders as a DialogContent sized md, full-screen on mobile", () => {
      renderCreate();
      fireEvent.click(screen.getByRole("button", { name: t.add }));
      const content = screen.getByRole("dialog");
      expect(content.className).toContain("md:max-w-[600px]");
      expect(content.className).toContain("inset-0");
      expect(content.className).toContain("md:rounded-[22px]");
    });

    it("shows the mobile back-chevron header with the create/edit title", () => {
      renderCreate();
      fireEvent.click(screen.getByRole("button", { name: t.add }));
      expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
      expect(screen.getAllByRole("heading", { name: t.createTitle }).length).toBeGreaterThan(0);
    });

    it("keeps the primary button in DialogContent's persistent footer", async () => {
      renderCreate();
      fireEvent.click(screen.getByRole("button", { name: t.add }));
      const addBtn = screen
        .getAllByRole("button", { name: t.add })
        .find((b) => b.getAttribute("type") === "submit");
      expect(addBtn?.closest('[data-slot="dialog-footer"]')).not.toBeNull();
    });

    it("keeps the delete-confirm flow out of the pinned footer", async () => {
      renderEdit();
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      fireEvent.click(screen.getByRole("button", { name: t.delete }));
      const confirmBtn = await screen.findByRole("button", { name: t.confirmDelete });
      expect(confirmBtn.closest('[data-slot="dialog-footer"]')).toBeNull();
    });

    it("generates a fresh id per mount, not a hardcoded one (useId, not a literal string)", () => {
      // Two instances open at once would put the second trigger under Radix's
      // aria-hidden focus trap for the first — mount/capture/unmount instead, which
      // still proves the id isn't the hardcoded literal the pre-migration Sheet used.
      renderCreate();
      fireEvent.click(screen.getByRole("button", { name: t.add }));
      const firstId = screen.getByLabelText(tf.holderName).id;
      cleanup();

      renderCreate();
      fireEvent.click(screen.getByRole("button", { name: t.add }));
      const secondId = screen.getByLabelText(tf.holderName).id;

      expect(firstId).not.toBe("holder-name");
      expect(firstId).not.toBe(secondId);
    });
  });
});
