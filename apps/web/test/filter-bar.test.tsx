import { describe, it, expect, afterEach, vi } from "vitest";
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
  onNavigateSpy,
}: {
  initialYear?: string;
  yearOptions?: string[];
  draftCount?: number;
  /** Lets a test observe the raw calls FilterBar makes, in addition to the Harness
   *  applying them to local state. */
  onNavigateSpy?: (keyOrUpdates: string | Record<string, string | undefined>) => void;
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
      onNavigateWithParam={(keyOrUpdates, value) => {
        // Mirrors useTransactionUrlNav's real single-key/batch overload — see its own
        // test (use-transaction-url-nav.test.tsx) for why the batch form matters (a real
        // router.push race the single-key form alone can't be made safe for).
        onNavigateSpy?.(keyOrUpdates);
        const updates = typeof keyOrUpdates === "string" ? { [keyOrUpdates]: value } : keyOrUpdates;
        if ("type" in updates) setTypeFilter(updates.type);
        if ("year" in updates) setYearFilter(updates.year);
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

  // Regression test: clearAllFilters() used to call onNavigateWithParam("type",
  // undefined) then onNavigateWithParam("year", undefined) as two separate calls. In
  // production those become two sequential router.push() calls racing against the same
  // stale searchParams snapshot — observed live as the year filter reappearing after
  // closing the sheet right after "Clear all". This Harness applies updates
  // synchronously so it can't reproduce the race itself, but it can and must assert the
  // fix's actual contract: one batched call, not two.
  it("Clear all issues a single batched onNavigateWithParam call, not one per key", () => {
    const onNavigateSpy = vi.fn();
    renderHarness({ initialYear: "2025", onNavigateSpy });
    openMobileSheet();

    fireEvent.click(screen.getByRole("button", { name: t.filterClearAll }));

    const urlUpdateCalls = onNavigateSpy.mock.calls.filter(([arg]) => typeof arg === "object");
    expect(urlUpdateCalls).toHaveLength(1);
    expect(urlUpdateCalls[0][0]).toEqual({ type: undefined, year: undefined });
  });
});
