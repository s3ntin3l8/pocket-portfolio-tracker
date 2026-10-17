import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import type { NetWorth } from "@portfolio/api-client";
import {
  allocationBreakdown,
  summarizePortfolio,
  type CoreTransaction,
  type AllocationInstrumentMeta,
} from "@portfolio/core";
import messages from "../messages/en.json";

// Real en.json translations, so a region key renders the label a user would see.
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "en", messages, namespace: namespace as "Region" }),
}));
// Only the region/currency card is under test; the other rail cards are stubbed.
vi.mock("@/components/holdings/portfolio-value-card", () => ({
  PortfolioValueCard: () => <div data-testid="value-card" />,
}));
vi.mock("@/components/holdings/allocation-card", () => ({
  AllocationCard: () => <div data-testid="alloc" />,
}));
vi.mock("@/components/gain-explainer", () => ({
  GainExplainer: () => <span />,
}));

import { HoldingsSidebar } from "../src/components/holdings/holdings-sidebar";

const NYSE = "inst-nyse";
const TSX = "inst-tsx";

function tx(p: Partial<CoreTransaction>): CoreTransaction {
  return {
    instrumentId: null,
    type: "buy",
    quantity: "1",
    price: "0",
    fees: "0",
    currency: "USD",
    executedAt: new Date("2026-01-01"),
    ...p,
  };
}

/** A US and a Canadian listing plus USD cash: all of it is North America. */
function netWorth(): NetWorth {
  const summary = summarizePortfolio({
    transactions: [
      tx({ type: "deposit", price: "120", currency: "USD" }),
      tx({ type: "deposit", price: "50", currency: "CAD" }),
      tx({ instrumentId: NYSE, price: "100", currency: "USD" }),
      tx({ instrumentId: TSX, price: "50", currency: "CAD" }),
    ],
    prices: { [NYSE]: { price: "100", currency: "USD" }, [TSX]: { price: "50", currency: "CAD" } },
    displayCurrency: "USD",
    cashCounted: true,
    fx: () => "1",
  });
  const meta: Record<string, AllocationInstrumentMeta> = {
    [NYSE]: { assetClass: "equity", market: "NYSE" },
    [TSX]: { assetClass: "equity", market: "TSX" },
  };
  return {
    netWorth: "170",
    displayCurrency: "USD",
    totalCost: "150",
    totalMarketValue: "150",
    totalUnrealizedPnL: "0",
    totalDayChange: "0",
    holdings: [],
    allocation: allocationBreakdown(summary, meta),
  } as unknown as NetWorth;
}

describe("HoldingsSidebar — region rows", () => {
  it("renders one North America row for US and Canadian holdings plus USD cash", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {await HoldingsSidebar({ summary: netWorth(), locale: "en" })}
      </NextIntlClientProvider>,
    );
    expect(screen.getAllByText("North America")).toHaveLength(1);
    expect(screen.getByText("100.0%")).toBeInTheDocument();
  });
});
