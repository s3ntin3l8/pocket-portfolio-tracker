import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import messages from "../messages/en.json";
import {
  DistributionCard,
  HarvestRow,
  HarvestSummaryNote,
  type TaxTranslator,
} from "../src/components/tax/tax-cards";
import type { HarvestSuggestion, TaxDistribution } from "@portfolio/api-client";

// These components take `t` as a directly-injected prop (the page's established
// pattern — see apps/web/src/app/[locale]/(app)/tax/page.tsx), not via `useTranslations`,
// so no NextIntlClientProvider is needed. This stub reads the real `Tax` namespace from
// en.json with basic `{key}` interpolation, so assertions exercise real copy.
function makeT(): TaxTranslator {
  const tax = messages.Tax as unknown as Record<string, unknown>;
  return (key, values) => {
    let val: unknown = tax;
    for (const part of key.split(".")) {
      val = (val as Record<string, unknown> | undefined)?.[part];
    }
    if (typeof val !== "string") return key;
    if (!values) return val;
    return val.replace(/\{(\w+)\}/g, (_, k: string) =>
      values[k] !== undefined ? String(values[k]) : `{${k}}`,
    );
  };
}

const money = (n: string | number) => `Rp ${Number(n).toLocaleString("en")}`;
const t = makeT();

describe("DistributionCard", () => {
  const distribution: TaxDistribution = {
    holderAllowanceCap: "1000",
    totalAllocated: "1000",
    remainingToDistribute: "0",
    overAllocated: false,
  };

  it("renders the cap/allocated/remaining figures", () => {
    render(<DistributionCard distribution={distribution} money={money} t={t} />);
    expect(screen.getByText("FSA distribution across depots")).toBeInTheDocument();
    expect(screen.getAllByText("Rp 1,000").length).toBeGreaterThan(0);
  });

  it("flags over-allocation with a warning banner", () => {
    render(
      <DistributionCard
        distribution={{ ...distribution, totalAllocated: "1200", overAllocated: true }}
        money={money}
        t={t}
      />,
    );
    expect(screen.getByText(/exceeds the personal cap/)).toBeInTheDocument();
  });
});

describe("HarvestRow", () => {
  const suggestion: HarvestSuggestion = {
    instrumentId: "i-nio",
    unrealizedGross: "-184",
    tfRate: "0.3",
    unrealizedAdjusted: "-128.8",
    harvestableGross: "184",
    taxSaving: "49",
    instrument: { symbol: "NIO", name: "NIO Inc.", assetClass: "equity", market: "US" },
  };

  it("renders the harvest button linking to the prefilled sell draft", () => {
    render(<HarvestRow s={suggestion} money={money} t={t} />);
    expect(screen.getByText("NIO")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Harvest" });
    expect(link).toHaveAttribute("href", "/transactions/new?harvestInstrument=i-nio");
  });

  it("shows the Teilfreistellung note when a TF rate applies", () => {
    render(<HarvestRow s={suggestion} money={money} t={t} />);
    expect(screen.getByText("TF 30% applied")).toBeInTheDocument();
  });
});

describe("HarvestSummaryNote", () => {
  it("aggregates every suggestion into one sentence", () => {
    const suggestions: HarvestSuggestion[] = [
      {
        instrumentId: "i1",
        unrealizedGross: "-184",
        tfRate: "0",
        unrealizedAdjusted: "-184",
        harvestableGross: "184",
        taxSaving: "49",
        instrument: null,
      },
      {
        instrumentId: "i2",
        unrealizedGross: "-96",
        tfRate: "0",
        unrealizedAdjusted: "-96",
        harvestableGross: "96",
        taxSaving: "25",
        instrument: null,
      },
    ];
    render(<HarvestSummaryNote suggestions={suggestions} money={money} t={t} />);
    expect(screen.getByText(/Harvest all 2/)).toBeInTheDocument();
    expect(screen.getByText(/Rp 280/)).toBeInTheDocument();
    expect(screen.getByText(/Rp 74/)).toBeInTheDocument();
  });

  it("renders nothing when there's nothing harvestable", () => {
    const { container } = render(
      <HarvestSummaryNote
        suggestions={[
          {
            instrumentId: "i1",
            unrealizedGross: "0",
            tfRate: "0",
            unrealizedAdjusted: "0",
            harvestableGross: "0",
            taxSaving: "0",
            instrument: null,
          },
        ]}
        money={money}
        t={t}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
