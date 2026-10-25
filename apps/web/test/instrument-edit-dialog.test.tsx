import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { toast } from "sonner";
import { ApiError, type Instrument } from "@portfolio/api-client";
import messages from "../messages/en.json";
import { Button } from "@/components/ui/button";
import { InstrumentEditDialog } from "@/components/instrument-edit-dialog";

const refresh = vi.fn();
const updateInstrument = vi.fn(async (..._args: unknown[]) => ({}) as never);

vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/api", () => ({ useApiClient: () => ({ updateInstrument }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const t = messages.Instrument;
const tb = messages.BondTerms;

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

const BOND: Instrument = {
  id: "b1",
  isin: null,
  wkn: null,
  symbol: "SBR015T2",
  name: "SBR015T2",
  assetClass: "bond",
  market: "IDX",
  currency: "IDR",
  faceValue: "1000000",
  couponSchedule: "monthly",
  maturityDate: "2028-07-10",
  couponRateSchedule: {
    floorRate: "0.0675",
    periods: [{ from: "2026-01-10", to: "2026-04-10", rate: "0.0675" }],
  },
} as Instrument;

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

  describe("Teilfreistellung override", () => {
    const ETF = { ...INSTRUMENT, assetClass: "etf", partialExemptionRate: "0.15" } as Instrument;

    it("is hidden for non-fund classes and never sent", async () => {
      renderDialog();
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      expect(screen.queryByLabelText(t.tfRate)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: t.save }));
      await waitFor(() => expect(updateInstrument).toHaveBeenCalled());
      expect(updateInstrument.mock.calls[0]?.[1]).not.toHaveProperty("partialExemptionRate");
    });

    it("clears a stale stored override when saving a non-fund class", async () => {
      renderDialog({ ...INSTRUMENT, partialExemptionRate: "0.15" } as Instrument);
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      fireEvent.click(screen.getByRole("button", { name: t.save }));
      await waitFor(() =>
        expect(updateInstrument).toHaveBeenCalledWith(
          "i1",
          expect.objectContaining({ partialExemptionRate: null }),
        ),
      );
    });

    it("pre-fills the stored fraction as a percent, with the class default as placeholder", () => {
      renderDialog({ ...ETF, partialExemptionRate: null } as Instrument);
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      expect(screen.getByLabelText(t.tfRate)).toHaveValue("");
      expect(screen.getByLabelText(t.tfRate)).toHaveAttribute("placeholder", "30%");
    });

    it("submits the percent as a fraction", async () => {
      renderDialog(ETF);
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      expect(screen.getByLabelText(t.tfRate)).toHaveValue("15");
      fireEvent.change(screen.getByLabelText(t.tfRate), { target: { value: "60" } });
      fireEvent.click(screen.getByRole("button", { name: t.save }));
      await waitFor(() =>
        expect(updateInstrument).toHaveBeenCalledWith(
          "i1",
          expect.objectContaining({ partialExemptionRate: "0.6" }),
        ),
      );
    });

    it("blank clears the override (null) and an invalid value blocks the save", async () => {
      renderDialog(ETF);
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      fireEvent.change(screen.getByLabelText(t.tfRate), { target: { value: "150" } });
      fireEvent.click(screen.getByRole("button", { name: t.save }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t.tfInvalid));
      expect(updateInstrument).not.toHaveBeenCalled();

      fireEvent.change(screen.getByLabelText(t.tfRate), { target: { value: "" } });
      fireEvent.click(screen.getByRole("button", { name: t.save }));
      await waitFor(() =>
        expect(updateInstrument).toHaveBeenCalledWith(
          "i1",
          expect.objectContaining({ partialExemptionRate: null }),
        ),
      );
    });
  });

  // -- Floating-rate bond schedule (Indonesian retail SBR/ST) ----------------

  describe("floating-rate schedule", () => {
    it("pre-fills the floating-rate schedule of a bond", () => {
      renderDialog(BOND);
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      expect(screen.getByLabelText(tb.floorRateLabel)).toHaveValue("6.75");
      expect(screen.getByLabelText("From")).toHaveValue("2026-01-10");
      expect(screen.getByLabelText("Rate % p.a.")).toHaveValue("6.75");
    });

    it("saves an edited rate schedule — percent-in converts to a fraction", async () => {
      renderDialog(BOND);
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      fireEvent.change(screen.getByLabelText(tb.floorRateLabel), { target: { value: "7" } });
      fireEvent.click(screen.getByRole("button", { name: t.save }));

      await waitFor(() =>
        expect(updateInstrument).toHaveBeenCalledWith(
          "b1",
          expect.objectContaining({
            couponRateSchedule: {
              floorRate: "0.07",
              periods: [{ from: "2026-01-10", to: "2026-04-10", rate: "0.0675" }],
            },
          }),
        ),
      );
    });

    it("clears the schedule when the floating-rate toggle is switched off", async () => {
      renderDialog(BOND);
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      fireEvent.click(screen.getByLabelText(tb.floatingRateLabel));
      fireEvent.click(screen.getByRole("button", { name: t.save }));

      await waitFor(() =>
        expect(updateInstrument).toHaveBeenCalledWith(
          "b1",
          expect.objectContaining({ couponRateSchedule: null }),
        ),
      );
    });

    it("leaves the schedule alone for a bond that has none", async () => {
      const fixed = { ...BOND, couponRateSchedule: null } as Instrument;
      renderDialog(fixed);
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      fireEvent.change(screen.getByLabelText(t.symbol), { target: { value: "SBR015T2X" } });
      fireEvent.click(screen.getByRole("button", { name: t.save }));

      await waitFor(() => expect(updateInstrument).toHaveBeenCalled());
      const patch = vi.mocked(updateInstrument).mock.calls[0][1] as Record<string, unknown>;
      expect(patch).not.toHaveProperty("couponRateSchedule");
    });
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
