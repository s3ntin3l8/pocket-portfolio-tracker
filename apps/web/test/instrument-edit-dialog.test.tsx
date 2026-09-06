import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { toast } from "sonner";
import { ApiError, type Instrument } from "@portfolio/api-client";
import messages from "../messages/en.json";
import { Button } from "@/components/ui/button";
import { InstrumentEditDialog } from "@/components/instrument-edit-dialog";

const refresh = vi.fn();
const updateInstrument = vi.fn(async () => ({}) as never);

vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/api", () => ({ useApiClient: () => ({ updateInstrument }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const t = messages.Instrument;

const INSTRUMENT: Instrument = {
  id: "i1",
  isin: "US0378331005",
  wkn: "865985",
  symbol: "AAPL",
  name: "Apple Inc.",
  assetClass: "equity",
  market: "NASDAQ",
} as Instrument;

function renderDialog(instrument: Instrument = INSTRUMENT) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <InstrumentEditDialog instrument={instrument}>
        <Button>Edit</Button>
      </InstrumentEditDialog>
    </NextIntlClientProvider>,
  );
}

describe("InstrumentEditDialog", () => {
  beforeEach(() => {
    refresh.mockClear();
    updateInstrument.mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it("pre-fills every field from the instrument", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText(t.isin)).toHaveValue("US0378331005");
    expect(screen.getByLabelText(t.wkn)).toHaveValue("865985");
    expect(screen.getByLabelText(t.symbol)).toHaveValue("AAPL");
    expect(screen.getByLabelText(t.name)).toHaveValue("Apple Inc.");
    expect(screen.getByLabelText(t.market)).toHaveValue("NASDAQ");
  });

  it("saves the edited fields and shows a success toast", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText(t.symbol), { target: { value: "AAPL2" } });
    fireEvent.click(screen.getByRole("button", { name: t.save }));

    await waitFor(() =>
      expect(updateInstrument).toHaveBeenCalledWith(
        "i1",
        expect.objectContaining({ symbol: "AAPL2" }),
      ),
    );
    expect(refresh).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(t.editSaved);
  });

  it("shows a conflict-specific error for a duplicate ISIN/WKN", async () => {
    updateInstrument.mockRejectedValueOnce(
      new ApiError(409, JSON.stringify({ error: "identifier_conflict" })),
    );
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: t.save }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t.editConflict));
  });

  it("shows a generic error for anything else", async () => {
    updateInstrument.mockRejectedValueOnce(new Error("network down"));
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: t.save }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t.editError));
  });

  it("resets fields to the instrument's values each time it reopens", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText(t.symbol), { target: { value: "EDITED" } });
    // Close without saving, then reopen — reset() should discard the edit.
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText(t.symbol)).toHaveValue("AAPL");
  });

  describe("overlay chrome (#625 migration)", () => {
    it("renders as a DialogContent sized sm, full-screen on mobile", () => {
      renderDialog();
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      const content = screen.getByRole("dialog");
      expect(content.className).toContain("md:max-w-[480px]");
      expect(content.className).toContain("inset-0");
    });

    it("shows the mobile back-chevron header with the edit title", () => {
      renderDialog();
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
      expect(screen.getAllByRole("heading", { name: t.editTitle }).length).toBeGreaterThan(0);
    });

    it("keeps the save button in DialogContent's persistent footer", () => {
      renderDialog();
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      const saveBtn = screen.getByRole("button", { name: t.save });
      expect(saveBtn.closest('[data-slot="dialog-footer"]')).not.toBeNull();
    });
  });
});
