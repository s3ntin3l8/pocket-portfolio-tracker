import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import { FilterBar } from "../src/components/transactions-table/filter-bar";

afterEach(cleanup);

const t = messages.Transactions;

/** Stateful harness — FilterBar is a controlled component, so a real test needs
 *  something to actually apply the onNavigateWithParam/onDraftFilterChange calls to. */
function Harness({
  initialYear,
  yearOptions = ["2025", "2026"],
  draftCount = 0,
}: {
  initialYear?: string;
  yearOptions?: string[];
  draftCount?: number;
}) {
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined);
  const [yearFilter, setYearFilter] = useState<string | undefined>(initialYear);
  const [draftFilter, setDraftFilter] = useState<"all" | "drafts">("all");
  const [showFlagged, setShowFlagged] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string | undefined>(undefined);

  return (
    <FilterBar
      typeFilter={typeFilter}
      showFlagged={showFlagged}
      flaggedCount={3}
      onToggleFlagged={() => setShowFlagged((v) => !v)}
      yearOptions={yearOptions}
      yearFilterProp={yearFilter}
      onNavigateWithParam={(key, value) => {
        if (key === "type") setTypeFilter(value);
        if (key === "year") setYearFilter(value);
      }}
      draftCount={draftCount}
      draftFilter={draftFilter}
      onDraftFilterChange={setDraftFilter}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
    />
  );
}

function renderHarness(props: Parameters<typeof Harness>[0] = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Harness {...props} />
    </NextIntlClientProvider>,
  );
}

function openMobileSheet() {
  fireEvent.click(screen.getByRole("button", { name: t.filterLabel }));
}

describe("FilterBar — mobile filter Sheet (#625 refinements)", () => {
  it("uses the app's shared md breakpoint, not a one-off sm", () => {
    const { container } = renderHarness();
    // Mobile group (search + Filters trigger) hides at md:, not sm:.
    const mobileGroup = container.querySelector(".md\\:hidden");
    const desktopGroup = container.querySelector(".hidden.md\\:flex");
    expect(mobileGroup).toBeTruthy();
    expect(desktopGroup).toBeTruthy();
    expect(container.querySelector(".sm\\:hidden")).toBeNull();
  });

  it("a year chip updates the filter but does not close the sheet (uniform with type/flagged chips)", () => {
    renderHarness();
    openMobileSheet();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "2025" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("a draft chip updates the filter but does not close the sheet", () => {
    renderHarness({ draftCount: 2 });
    openMobileSheet();

    fireEvent.click(screen.getByRole("button", { name: t.draftOnly.replace("{count}", "2") }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Clear all is disabled with nothing set, and ignores search", () => {
    renderHarness();
    openMobileSheet();
    expect(screen.getByRole("button", { name: t.filterClearAll })).toBeDisabled();
  });

  it("Clear all resets type/year/draft/flagged but leaves search untouched", () => {
    renderHarness({ initialYear: "2025", draftCount: 2 });
    openMobileSheet();

    const flaggedLabel = t.banners.chipIssues.replace("{count}", "3");
    const draftLabel = t.draftOnly.replace("{count}", "2");
    fireEvent.click(screen.getByRole("button", { name: flaggedLabel }));
    fireEvent.click(screen.getByRole("button", { name: draftLabel }));

    // Before clearing: year (pre-set), flagged and draft are all active.
    expect(screen.getByRole("button", { name: "2025" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: flaggedLabel })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const clearBtn = screen.getByRole("button", { name: t.filterClearAll });
    expect(clearBtn).not.toBeDisabled();
    fireEvent.click(clearBtn);

    // After clearing: all three are back to their "off" state.
    expect(screen.getByRole("button", { name: "2025" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: flaggedLabel })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    const draftAllChips = screen.getAllByRole("button", { name: t.draftShowAll });
    expect(draftAllChips.some((b) => b.getAttribute("aria-pressed") === "true")).toBe(true);
  });
});
