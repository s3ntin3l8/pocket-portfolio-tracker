import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import type { HoldingValuation } from "@portfolio/api-client";

const routerPush = vi.fn();
const media = vi.hoisted(() => ({ desktop: false }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: routerPush }),
  Link: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/use-media-query", () => ({ useMediaQuery: () => media.desktop }));
// jsdom has no View Transitions API: stand in for <ViewTransition> with a marker element.
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  ViewTransition: ({ name, children }: { name?: string; children: React.ReactNode }) => (
    <div data-vt-name={name}>{children}</div>
  ),
}));

import { HoldingsTable } from "../src/components/holdings-table";

const makeHolding = (
  symbol: string,
  quantity: string,
  avgCost: string,
  instrumentId = symbol,
): HoldingValuation => ({
  instrumentId,
  quantity,
  avgCost,
  costBasis: String(Number(quantity) * Number(avgCost)),
  realizedPnL: "0",
  costCurrency: "IDR",
  price: "100",
  currency: "IDR",
  marketValue: String(Number(quantity) * 100),
  marketValueDisplay: String(Number(quantity) * 100),
  costBasisDisplay: String(Number(quantity) * Number(avgCost)),
  unrealizedPnL: "0",
  unrealizedPnLDisplay: "0",
  previousClose: null,
  dayChange: null,
  dayChangePct: null,
  instrument: {
    symbol,
    name: symbol + " Corp",
    displayName: null,
    assetClass: "equity",
    unit: "shares",
    market: "IDX",
    sector: null,
    sectorWeights: null,
    countryWeights: null,
    country: null,
    industry: null,
  },
});

function names(container: HTMLElement) {
  return Array.from(container.querySelectorAll("[data-vt-name]")).map((el) => ({
    name: el.getAttribute("data-vt-name"),
    inDesktopTable: !!el.closest("table"),
  }));
}

function renderTable() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <HoldingsTable rows={[makeHolding("AAPL", "10", "1500", "id-1")]} currency="IDR" />
    </NextIntlClientProvider>,
  );
}

describe("HoldingsTable logo transition name", () => {
  beforeEach(() => {
    media.desktop = false;
  });

  it("names only the mobile card logo below lg", () => {
    const { container } = renderTable();
    expect(names(container)).toEqual([{ name: "instrument-logo-id-1", inDesktopTable: false }]);
  });

  it("names only the desktop table logo at lg+", () => {
    media.desktop = true;
    const { container } = renderTable();
    expect(names(container)).toEqual([{ name: "instrument-logo-id-1", inDesktopTable: true }]);
  });
});
