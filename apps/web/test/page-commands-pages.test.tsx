import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect } from "react";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";

let mockPath = "/transactions";
const push = vi.fn();
const replace = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push, replace, refresh: vi.fn() }),
  usePathname: () => mockPath,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
let mockSearch = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => mockSearch }));
vi.mock("@/lib/api", () => ({ useApiClient: () => ({}) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { PageCommandsProvider, usePageCommands } from "../src/components/page-commands";
import type { PageCommandGroup } from "../src/components/page-commands";
import { TransactionsTable } from "../src/components/transactions-table";
import { IncomeTimeline } from "../src/components/income/income-timeline";
import type { IncomeEventRow } from "../src/components/income/income-events-table";

let groups: PageCommandGroup[] = [];
function Probe() {
  const current = usePageCommands();
  useEffect(() => {
    groups = current;
  });
  return null;
}
const nav = { navigate: vi.fn(), close: vi.fn() };
const s = messages.Search;

function renderWith(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PageCommandsProvider>
        {node}
        <Probe />
      </PageCommandsProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  push.mockClear();
  nav.navigate.mockClear();
  nav.close.mockClear();
  mockSearch = new URLSearchParams();
  mockPath = "/transactions";
  groups = [];
});

describe("Activity page commands", () => {
  it("offers 'show drafts only' when drafts exist and pushes status=draft, page reset", () => {
    mockSearch = new URLSearchParams("type=buy&page=3");
    renderWith(<TransactionsTable rows={[]} total={0} draftCount={2} />);
    const group = groups.find((g) => g.id === "activity-drafts")!;
    expect(group.items.map((i) => i.label)).toEqual([s.showDrafts]);
    group.items[0]!.run(nav);
    // Drafts is a push (a navigation back should undo), not a replace.
    expect(nav.navigate).toHaveBeenCalledWith("/transactions?type=buy&page=1&status=draft");
  });

  it("offers 'show all' while the drafts filter is active", () => {
    mockSearch = new URLSearchParams("status=draft&page=2");
    renderWith(<TransactionsTable rows={[]} total={0} draftCount={0} statusFilter="draft" />);
    const group = groups.find((g) => g.id === "activity-drafts")!;
    expect(group.items.map((i) => i.label)).toEqual([s.showAllTransactions]);
    group.items[0]!.run(nav);
    expect(nav.navigate).toHaveBeenCalledWith("/transactions?page=1");
  });

  it("offers nothing without drafts", () => {
    renderWith(<TransactionsTable rows={[]} total={0} draftCount={0} />);
    expect(groups.find((g) => g.id === "activity-drafts")?.items ?? []).toHaveLength(0);
  });
});

describe("Income page commands", () => {
  const row = (date: string): IncomeEventRow => ({
    instrumentId: "i",
    symbol: "BBCA",
    name: "Bank",
    displayName: null,
    type: "dividend",
    date,
    amount: "1",
    currency: "IDR",
  });

  beforeEach(() => {
    mockPath = "/income";
  });

  it("offers the other years and navigates with ?year= (replace, so the palette's back marker can't undo it)", () => {
    renderWith(<IncomeTimeline rows={[row("2026-01-01"), row("2025-01-01")]} locale="en" />);
    const group = groups.find((g) => g.id === "income-year")!;
    // The active filter ("all" here) is not offered again.
    expect(group.items.map((i) => i.label)).toEqual(["Income year: 2026", "Income year: 2025"]);
    group.items.find((i) => i.id === "2025")!.run(nav);
    expect(nav.navigate).toHaveBeenCalledWith("/income?year=2025", { replace: true });
  });

  it("offers 'all years' once a year is selected and clears the param", () => {
    window.history.replaceState(null, "", "/income?year=2025");
    mockSearch = new URLSearchParams("year=2025");
    renderWith(<IncomeTimeline rows={[row("2026-01-01"), row("2025-01-01")]} locale="en" />);
    const group = groups.find((g) => g.id === "income-year")!;
    expect(group.items.map((i) => i.label)).toEqual([s.incomeAllYears, "Income year: 2026"]);
    group.items[0]!.run(nav);
    expect(nav.navigate).toHaveBeenCalledWith("/income", { replace: true });
  });
});

describe("buildTradesHref", () => {
  it("sets the method, keeps scope, and resets page", async () => {
    const { buildTradesHref } = await import("../src/components/trades-page-commands");
    expect(buildTradesHref("/trades", "scope=all&page=3", "fifo")).toBe(
      "/trades?scope=all&method=fifo",
    );
  });
});
