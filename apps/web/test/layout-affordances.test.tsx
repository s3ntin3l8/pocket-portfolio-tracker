import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import { ResponsiveMoney } from "../src/components/ui/responsive-money";
import { TwoStatFooter } from "../src/components/reports/two-stat-footer";
import { Table, TABLE_VALUE, TABLE_VALUE_STRONG } from "../src/components/ui/table";
import { MobileView } from "../src/components/transactions-table/mobile";
import { HoldingsTable } from "../src/components/holdings-table";
import { TOOLBAR_FILTERS } from "../src/components/table-toolbar";
import { authViaKey } from "../src/lib/auth-label";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const src = (rel: string) => readFileSync(resolve(__dirname, "..", rel), "utf8");

function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("money never truncates (audit G5)", () => {
  it("ResponsiveMoney shows the compact form below sm and the full form from sm up", () => {
    const { container } = render(<ResponsiveMoney full="€1,234,567.89" compact="€1.2M" />);
    const compact = container.querySelector('[data-money="compact"]')!;
    const full = container.querySelector('[data-money="full"]')!;
    expect(compact).toHaveTextContent("€1.2M");
    expect(compact.className).toContain("sm:hidden");
    expect(full).toHaveTextContent("€1,234,567.89");
    expect(full.className).toContain("hidden");
    expect(full.className).toContain("sm:inline");
    // Screen readers get the full-precision figure exactly once.
    expect(container.querySelector(".sr-only")).toHaveTextContent("€1,234,567.89");
    expect(container.firstElementChild!.className).toContain("whitespace-nowrap");
    expect(container.innerHTML).not.toContain("truncate");
  });

  it("ResponsiveMoney renders a single nowrap span when there is no distinct compact form", () => {
    const { container } = render(<ResponsiveMoney full="€12.00" />);
    expect(container.querySelectorAll("span")).toHaveLength(1);
    expect(container.firstElementChild!.className).toContain("whitespace-nowrap");
  });

  it("the report footer never ellipsizes a value and lets its label wrap", () => {
    const { getByText } = wrap(
      <TwoStatFooter
        metrics={[{ label: "Realized all-time", value: "€570.4K" }]}
        openLabel="Open"
        accentColor="#000"
      />,
    );
    const value = getByText("€570.4K");
    expect(value.className).toContain("whitespace-nowrap");
    expect(value.className).not.toContain("truncate");
    expect(getByText("Realized all-time").className).not.toContain("truncate");
  });

  it("table money cells are nowrap", () => {
    expect(TABLE_VALUE).toContain("whitespace-nowrap");
    expect(TABLE_VALUE_STRONG).toContain("whitespace-nowrap");
  });
});

describe("tables never clip silently (audit G5)", () => {
  it("edgeAffordance opts a table into the scroll-shadow wrapper and pinned first column", () => {
    const { container } = render(
      <Table edgeAffordance>
        <tbody />
      </Table>,
    );
    expect(container.firstElementChild!.className).toContain("scroll-shadow-x");
    expect(container.querySelector("table")!.className).toContain("sticky-first-col");
  });

  it("defines the shadow, sticky-column and FAB utilities in globals.css", () => {
    const css = src("src/app/globals.css");
    expect(css).toMatch(/@utility scroll-shadow-x/);
    expect(css).toMatch(/@utility sticky-first-col/);
    expect(css).toMatch(/@utility fab-inset[\s\S]*scroll-padding-bottom/);
  });

  it("the Holdings filter chips take the remaining row width instead of running under search", () => {
    expect(TOOLBAR_FILTERS).toContain("md:flex-1");
    expect(TOOLBAR_FILTERS).toContain("md:flex-wrap");
    expect(TOOLBAR_FILTERS).toContain("scroll-shadow-x");
  });
});

describe("FAB inset on the mobile lists (audit G5)", () => {
  it("Activity's list carries fab-inset and switches to the table at lg, not md", () => {
    const { container } = wrap(
      <MobileView
        dayGroups={[]}
        selectionMode={false}
        selected={new Set()}
        anomalyByTxId={new Map()}
        longPressHandlers={() => ({
          onPointerDown: () => {},
          onPointerUp: () => {},
          onPointerLeave: () => {},
          onPointerMove: () => {},
        })}
        onRowActivate={() => {}}
        hasActiveFilter={false}
        showEmpty={false}
      />,
    );
    const list = container.firstElementChild!;
    expect(list.className).toContain("fab-inset");
    expect(list.className).toContain("lg:hidden");
  });

  it("Holdings' list carries fab-inset; the six-column table only shows from lg", () => {
    const { container } = wrap(<HoldingsTable rows={[]} currency="EUR" cash={{ EUR: "10" }} />);
    const list = container.querySelector(".fab-inset");
    expect(list).not.toBeNull();
    expect(list!.className).toContain("lg:hidden");
    const tableWrap = container.querySelector(".scroll-shadow-x")!.parentElement!;
    expect(tableWrap.className).toContain("hidden");
    expect(tableWrap.className).toContain("lg:block");
  });

  it("Savings applies the shared fab-inset to its page content", () => {
    expect(src("src/app/[locale]/(app)/savings/page.tsx")).toContain('className="fab-inset');
  });
});

describe("auth label (audit G8)", () => {
  it("prefers the dev-bypass label, then local, then OIDC", () => {
    expect(authViaKey("oidc|abc", true)).toBe("authViaDev");
    expect(authViaKey("local|abc", true)).toBe("authViaDev");
    expect(authViaKey("local|abc", false)).toBe("authViaLocal");
    expect(authViaKey("abc", false)).toBe("authVia");
    expect(authViaKey(undefined, false)).toBe("authVia");
  });
});
