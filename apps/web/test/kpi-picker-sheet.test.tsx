import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";

const refresh = vi.fn();
const putPreferences = vi.fn().mockResolvedValue({ dashboardPeriod: "max", dashboardKpis: null });

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/lib/api", () => ({
  useApiClient: () => ({ putPreferences }),
}));

const { KpiPickerSheet } = await import("../src/components/kpi-picker-sheet");

const t = messages.KpiPicker;

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

/** useMediaQuery reads window.matchMedia — see edit-transaction-sheet.test.tsx. */
function mockMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
}

describe("KpiPickerSheet", () => {
  afterEach(() => {
    cleanup();
    refresh.mockClear();
    putPreferences.mockClear();
  });

  it("renders the settings button", () => {
    renderWithIntl(<KpiPickerSheet currentKpis={null} />);
    // The sr-only text should exist in the DOM
    expect(screen.getByText("Customize dashboard")).toBeInTheDocument();
  });

  it("renders with pre-selected KPIs", () => {
    renderWithIntl(<KpiPickerSheet currentKpis={["netWorth", "xirr"]} />);
    expect(screen.getByText("Customize dashboard")).toBeInTheDocument();
  });

  describe("refinement chrome (#625 migration)", () => {
    it("opens as a bottom Sheet below md, and saves the toggled selection", async () => {
      mockMatchMedia(false);
      renderWithIntl(<KpiPickerSheet currentKpis={["netWorth", "xirr"]} />);
      fireEvent.click(screen.getByRole("button", { name: t.title }));

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("switch", { name: t.dayChange }));
      fireEvent.click(screen.getByRole("button", { name: t.save }));

      await waitFor(() => expect(putPreferences).toHaveBeenCalled());
      expect(putPreferences).toHaveBeenCalledWith({
        dashboardKpis: expect.arrayContaining(["netWorth", "xirr", "dayChange"]),
      });
      expect(refresh).toHaveBeenCalled();
    });

    it("opens as a non-modal Popover anchored to the trigger at md:+, not a full-screen page", async () => {
      mockMatchMedia(true);
      renderWithIntl(<KpiPickerSheet currentKpis={["netWorth"]} />);
      fireEvent.click(screen.getByRole("button", { name: t.title }));

      const content = await screen.findByText(t.description);
      const panel = content.closest('[role="dialog"]')!;
      // Popover.Content is exposed as role="dialog" too (Radix), but non-modal — no
      // aria-modal, and none of DialogContent's full-screen-on-mobile classes.
      expect(panel.getAttribute("aria-modal")).not.toBe("true");
      expect(panel.className).not.toContain("inset-0");
      expect(panel.className).toContain("w-72");
    });

    it("cancel closes without saving", () => {
      mockMatchMedia(false);
      renderWithIntl(<KpiPickerSheet currentKpis={["netWorth"]} />);
      fireEvent.click(screen.getByRole("button", { name: t.title }));
      fireEvent.click(screen.getByRole("switch", { name: t.income }));
      fireEvent.click(screen.getByRole("button", { name: t.cancel }));

      expect(putPreferences).not.toHaveBeenCalled();
    });
  });
});
