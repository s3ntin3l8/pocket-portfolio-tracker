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

/** Mutable matchMedia mock: the test mutates `matches` via the returned setter, then
 *  triggers `change` so useSyncExternalStore (used by `useMediaQuery`) re-runs. */
function makeMatchMedia(initialMatches: boolean) {
  const listeners: Array<() => void> = [];
  let matches = initialMatches;
  window.matchMedia = vi.fn().mockImplementation(() => ({
    get matches() {
      return matches;
    },
    media: "",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: (_event: string, cb: () => void) => {
      listeners.push(cb);
    },
    removeEventListener: (_event: string, cb: () => void) => {
      const i = listeners.indexOf(cb);
      if (i !== -1) listeners.splice(i, 1);
    },
    dispatchEvent: vi.fn(),
  }));
  return {
    set(next: boolean) {
      matches = next;
      listeners.forEach((cb) => cb());
    },
  };
}

/** Back-compat wrapper used by the pre-existing tests. */
function mockMatchMedia(matches: boolean) {
  makeMatchMedia(matches);
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

    it("toggle state survives a viewport resize across the md breakpoint", () => {
      // Regression: the old design branched on `isDesktop` and returned one chrome or
      // the other. Crossing the md breakpoint remounted the chrome and discarded the
      // open in-progress toggle list. A single mounted tree is supposed to keep state
      // regardless of which chrome is visible.
      const mq = makeMatchMedia(false);
      renderWithIntl(<KpiPickerSheet currentKpis={["netWorth", "xirr"]} />);
      fireEvent.click(screen.getByRole("button", { name: t.title }));
      fireEvent.click(screen.getByRole("switch", { name: t.dayChange }));
      // Crossing md while open: chrome swaps (Sheet → Popover), state must persist.
      mq.set(true);
      // The previously-toggled `dayChange` is still on (and `xirr` still on, the
      // pre-selected KPI we never touched is also still on).
      const dayChange = screen.getByRole("switch", { name: t.dayChange });
      expect(dayChange).toHaveAttribute("data-state", "checked");
      const xirr = screen.getByRole("switch", { name: t.xirr });
      expect(xirr).toHaveAttribute("data-state", "checked");
    });
  });
});
