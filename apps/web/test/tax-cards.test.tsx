import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import idMessages from "../messages/id.json";
import {
  EstimatedTaxHero,
  AllowanceSummaryBoxes,
  DistributionCard,
  HarvestRow,
  HarvestSummaryNote,
  VorabpauschaleRow,
  CoverageCard,
  type TaxTranslator,
} from "../src/components/tax/tax-cards";
import {
  DividendsTable,
  ByYearTable,
  IdIncomeTable,
  IdForeignIncomeTable,
  IdByYearTable,
} from "../src/components/tax/tax-tables";
import type { HarvestSuggestion, TaxDistribution, AllowanceUsage } from "@portfolio/api-client";
import type { IdIncomeTax } from "@portfolio/core";

// The four table components (DividendsTable, ByYearTable, IdIncomeTable,
// IdByYearTable) are now client components in ./tax-tables.tsx — they call
// `useTranslations("Tax")` internally, so render them inside the real next-intl
// provider. The non-table components here still take `t` as a directly-injected prop
// (the page's established pattern — see apps/web/src/app/[locale]/(app)/tax/page.tsx),
// so they use a plain-substitution stub for `t`.
function wrapClient(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

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

const CURRENCY = "IDR";
const LOCALE = "en";
const money = (n: string | number) => `Rp ${Number(n).toLocaleString("en")}`;
const t = makeT();

describe("EstimatedTaxHero", () => {
  it("renders the label, value, and description", () => {
    render(
      <EstimatedTaxHero
        label="Estimated tax · 2026"
        value="Rp 140,580"
        description="Abgeltungsteuer 25% on Rp 562,320"
      />,
    );
    expect(screen.getByText("Estimated tax · 2026")).toBeInTheDocument();
    expect(screen.getByText("Rp 140,580")).toBeInTheDocument();
    expect(screen.getByText("Abgeltungsteuer 25% on Rp 562,320")).toBeInTheDocument();
  });
});

describe("DividendsTable", () => {
  it("renders gross/tax/net per source, in the source's own currency, plus a total row", () => {
    wrapClient(
      <DividendsTable
        rows={[{ symbol: "SAP", currency: "EUR", gross: "168", tax: "35", net: "133" }]}
        totalsByCurrency={[{ currency: "EUR", gross: "168", tax: "35", net: "133" }]}
        locale="en"
        year={2026}
      />,
    );
    expect(screen.getByText("SAP")).toBeInTheDocument();
    expect(screen.getAllByText("€168.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("€35.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("€133.00").length).toBeGreaterThan(0);
  });

  it("joins multi-currency totals instead of summing across currencies", () => {
    wrapClient(
      <DividendsTable
        rows={[
          { symbol: "SAP", currency: "EUR", gross: "168", tax: "35", net: "133" },
          { symbol: "NVDA", currency: "USD", gross: "100", tax: "20", net: "80" },
        ]}
        totalsByCurrency={[
          { currency: "EUR", gross: "168", tax: "35", net: "133" },
          { currency: "USD", gross: "100", tax: "20", net: "80" },
        ]}
        locale="en"
        year={2026}
      />,
    );
    // Each row renders in its OWN currency, not a shared/converted one.
    expect(screen.getByText("€168.00")).toBeInTheDocument();
    expect(screen.getByText("$100.00")).toBeInTheDocument();
    // The total row joins per-currency amounts rather than summing raw numbers.
    expect(screen.getByText("€168.00 · $100.00")).toBeInTheDocument();
  });

  it("renders the empty state when there's no investment income", () => {
    wrapClient(<DividendsTable rows={[]} totalsByCurrency={[]} locale="en" year={2026} />);
    expect(screen.getByText(/No investment income/)).toBeInTheDocument();
  });
});

describe("ByYearTable", () => {
  it("renders newest-first rows with realized/dividends/FSA used/tax columns", () => {
    wrapClient(
      <ByYearTable
        rows={[
          { year: 2026, realized: "240", dividends: "168", fsaUsed: "408.00", tax: "0.00" },
          { year: 2025, realized: "100", dividends: "227", fsaUsed: "327.00", tax: "0.00" },
        ]}
        currency={CURRENCY}
        locale={LOCALE}
      />,
    );
    const years = screen.getAllByText(/^(2026|2025)$/).map((el) => el.textContent);
    expect(years).toEqual(["2026", "2025"]);
    expect(screen.getByText("FSA used")).toBeInTheDocument();
    expect(screen.getByText("IDR 408")).toBeInTheDocument();
    expect(screen.getByText("IDR 327")).toBeInTheDocument();
  });

  it("renders nothing when there are no years", () => {
    const { container } = wrapClient(<ByYearTable rows={[]} currency={CURRENCY} locale={LOCALE} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("AllowanceSummaryBoxes", () => {
  it("shows the allowance-left progress, its tax-saving-available figure, and taxable-gains", () => {
    render(
      <AllowanceSummaryBoxes
        usedPct={41}
        allowanceAnnual="1000"
        usedYtd="408"
        remaining="592"
        taxSavingAvailable="148"
        taxable="0"
        estimatedTax="0"
        money={money}
        t={t}
      />,
    );
    expect(screen.getByText("Allowance left")).toBeInTheDocument();
    expect(screen.getByText("Rp 592")).toBeInTheDocument();
    expect(screen.getByText("Taxable gains YTD")).toBeInTheDocument();
    expect(screen.getByText(/Rp 408 of Rp 1,000 used/)).toBeInTheDocument();
    // The "Tax saving available" figure — carried over from the old 3-up StatCard row so
    // it isn't lost by the 2-box relayout.
    expect(screen.getByText(/Tax saving available: Rp 148/)).toBeInTheDocument();
  });
});

function makeAllowanceUsage(overrides: Partial<AllowanceUsage> = {}): AllowanceUsage {
  return {
    year: 2026,
    allowanceAnnual: "1000",
    realizedGainsAdjusted: "0",
    incomeYtd: "0",
    vorabpauschaleAccrued: "2.93",
    vorabpauschaleCredited: "0",
    stockPot: { netGainLoss: "0", carryForwardApplied: "0.00", used: "0" },
    generalPot: { netGainLoss: "0", carryForwardApplied: "0.00", used: "0" },
    usedYtd: "0",
    taxableExcess: "0",
    remaining: "1000",
    taxRate: "0.25",
    taxSavingAvailable: "250",
    currency: "IDR",
    forecastIncomeRestOfYear: "0",
    projectedUsedFullYear: "0",
    projectedRemaining: "1000",
    projectedTaxSavingAvailable: "250",
    ...overrides,
  };
}

describe("VorabpauschaleRow", () => {
  it("shows accrued and credited Vorabpauschale amounts", () => {
    render(
      <VorabpauschaleRow
        allowanceUsage={makeAllowanceUsage({
          vorabpauschaleAccrued: "2.93",
          vorabpauschaleCredited: "1.10",
        })}
        money={money}
        t={t}
      />,
    );
    expect(screen.getByText("Rp 2.93")).toBeInTheDocument();
    expect(screen.getByText("Rp 1.1")).toBeInTheDocument();
  });

  it("pairs its tiles by its own width, not the viewport's", () => {
    const { container } = render(
      <VorabpauschaleRow allowanceUsage={makeAllowanceUsage({})} money={money} t={t} />,
    );
    const outer = container.firstElementChild!;
    expect(outer.getAttribute("class")).toBe("@container");
    const classes = (outer.firstElementChild!.getAttribute("class") ?? "").split(/\s+/);
    expect(classes).toContain("grid-cols-1");
    expect(classes).toContain("max-sm:@xs:grid-cols-2");
    expect(classes).toContain("@lg:grid-cols-2");
    expect(classes).not.toContain("grid-cols-2");
  });
});

describe("VorabpauschaleRow estimate flag", () => {
  it("labels the accrued figure as an estimate only when flagged", () => {
    const { rerender } = render(
      <VorabpauschaleRow allowanceUsage={makeAllowanceUsage()} money={money} t={t} />,
    );
    expect(screen.queryByText(/Estimated from year-start/)).toBeNull();
    rerender(
      <VorabpauschaleRow
        allowanceUsage={makeAllowanceUsage({ vorabpauschaleEstimated: true })}
        money={money}
        t={t}
      />,
    );
    expect(screen.getByText(/Estimated from year-start and year-end prices/)).toBeInTheDocument();
  });
});

describe("CoverageCard", () => {
  it("shows the taxable-excess branch when gains exceed the FSA, even in a year with a net trading loss", () => {
    // Stock pot loss, but dividends push taxableExcess above zero — the two-pot
    // system means a net trading loss does NOT imply no tax is owed.
    render(
      <CoverageCard
        allowanceUsage={makeAllowanceUsage({
          realizedGainsAdjusted: "-5000",
          taxableExcess: "2000",
        })}
        money={money}
        locale="en"
        t={t}
      />,
    );
    expect(screen.getByText(/Taxable income exceeding FSA/)).toBeInTheDocument();
    expect(screen.queryByText(/losses carried forward/)).not.toBeInTheDocument();
  });

  it("shows the loss-carried-forward branch only when nothing is taxable and there's a net trading loss", () => {
    render(
      <CoverageCard
        allowanceUsage={makeAllowanceUsage({
          realizedGainsAdjusted: "-500",
          taxableExcess: "0",
        })}
        money={money}
        locale="en"
        t={t}
      />,
    );
    expect(screen.getByText(/losses carried forward/)).toBeInTheDocument();
  });

  it("shows the FSA-covered branch when nothing is taxable and there's no net trading loss", () => {
    render(
      <CoverageCard
        allowanceUsage={makeAllowanceUsage({ realizedGainsAdjusted: "400", taxableExcess: "0" })}
        money={money}
        locale="en"
        t={t}
      />,
    );
    expect(screen.getByText(/covered by your FSA allowance/)).toBeInTheDocument();
  });

  it("reads the carry-forward-applied amount from the pots, not raw configured figures", () => {
    render(
      <CoverageCard
        allowanceUsage={makeAllowanceUsage({
          stockPot: { netGainLoss: "0", carryForwardApplied: "0.00", used: "0" },
          generalPot: { netGainLoss: "0", carryForwardApplied: "300.00", used: "0" },
        })}
        money={money}
        locale="en"
        t={t}
      />,
    );
    expect(screen.getByText(/Rp 300/)).toBeInTheDocument();
  });

  it("renders per-pot net gain/loss and used rows", () => {
    render(
      <CoverageCard
        allowanceUsage={makeAllowanceUsage({
          stockPot: { netGainLoss: "-500", carryForwardApplied: "0.00", used: "150" },
          generalPot: { netGainLoss: "1200", carryForwardApplied: "0.00", used: "800" },
        })}
        money={money}
        locale="en"
        t={t}
      />,
    );
    expect(screen.getByText("Rp -500")).toBeInTheDocument();
    expect(screen.getByText("Rp 150")).toBeInTheDocument();
    expect(screen.getByText("Rp 1,200")).toBeInTheDocument();
    expect(screen.getByText("Rp 800")).toBeInTheDocument();
    expect(screen.getByText("Stock pot")).toBeInTheDocument();
    expect(screen.getByText("General pot")).toBeInTheDocument();
  });

  it("hides carry-forward row when zero", () => {
    render(
      <CoverageCard
        allowanceUsage={makeAllowanceUsage({
          stockPot: { netGainLoss: "100", carryForwardApplied: "0.00", used: "50" },
          generalPot: { netGainLoss: "200", carryForwardApplied: "0.00", used: "100" },
        })}
        money={money}
        locale="en"
        t={t}
      />,
    );
    expect(screen.queryByText("Carry-forward")).not.toBeInTheDocument();
  });

  it("shows carry-forward row when non-zero", () => {
    render(
      <CoverageCard
        allowanceUsage={makeAllowanceUsage({
          stockPot: { netGainLoss: "0", carryForwardApplied: "100.00", used: "0" },
          generalPot: { netGainLoss: "0", carryForwardApplied: "0.00", used: "0" },
        })}
        money={money}
        locale="en"
        t={t}
      />,
    );
    expect(screen.getByText("Carry-forward")).toBeInTheDocument();
  });
});

describe("DistributionCard", () => {
  const distribution: TaxDistribution = {
    holderAllowanceCap: "1000",
    totalAllocated: "1000",
    remainingToDistribute: "0",
    overAllocated: false,
  };

  it("renders the cap/allocated/remaining figures in EUR, not the display currency", () => {
    // The page's display currency may be IDR; the Sparerpauschbetrag is still €1,000.
    render(
      <DistributionCard distribution={{ ...distribution, currency: "EUR" }} locale="en" t={t} />,
    );
    expect(screen.getByText("FSA distribution across depots")).toBeInTheDocument();
    expect(screen.getAllByText("€1,000").length).toBe(2); // cap + allocated (whole euros)
    expect(screen.queryByText(/IDR|Rp/)).not.toBeInTheDocument();
  });

  it("sizes its tiles by its own width: 3-up on a phone or from 512px, else stacked", () => {
    // Beside the rail the card is narrower than on a phone; a viewport breakpoint can't
    // tell, so the card is the container the grid queries.
    render(<DistributionCard distribution={distribution} locale="en" t={t} />);
    const tile = screen.getByText(t("distribution.cap")).closest(".bg-card")!;
    const grid = tile.parentElement!;
    const classes = (grid.getAttribute("class") ?? "").split(/\s+/);
    expect(classes).toContain("grid-cols-1");
    expect(classes).toContain("max-sm:@xs:grid-cols-3");
    expect(classes).toContain("@lg:grid-cols-3");
    expect(classes).not.toContain("grid-cols-3");
    expect(grid.parentElement!.getAttribute("class")).toMatch(/(^|\s)@container(\s|$)/);
  });

  it("defaults to EUR for a response that predates the currency field", () => {
    render(<DistributionCard distribution={distribution} locale="en" t={t} />);
    expect(screen.getAllByText("€1,000").length).toBe(2);
  });

  it("keeps cents on a non-whole euro amount", () => {
    render(
      <DistributionCard
        distribution={{ ...distribution, totalAllocated: "800.5", remainingToDistribute: "199.5" }}
        locale="en"
        t={t}
      />,
    );
    expect(screen.getByText("€800.50")).toBeInTheDocument();
    expect(screen.getByText("€199.50")).toBeInTheDocument();
  });

  it("lets the long German label hyphenate on a narrow tile (soft hyphens)", () => {
    for (const msgs of [messages, idMessages]) {
      const desc = (msgs as unknown as { Tax: { distribution: { capDesc: string } } }).Tax
        .distribution.capDesc;
      expect(desc).toContain("Sparer\u00adpausch\u00adbetrag");
    }
  });

  it("flags over-allocation with a warning banner", () => {
    render(
      <DistributionCard
        distribution={{ ...distribution, totalAllocated: "1200", overAllocated: true }}
        locale="en"
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
    expect(screen.getByText("NIO Inc.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Harvest" });
    expect(link).toHaveAttribute("href", "/tax?harvestInstrument=i-nio");
  });

  it("shows the Teilfreistellung note when a TF rate applies", () => {
    render(<HarvestRow s={suggestion} money={money} t={t} />);
    // The TF note is now folded into the row's single meta line.
    expect(screen.getByText(/TF 30% applied/)).toBeInTheDocument();
  });
});

describe("HarvestSummaryNote", () => {
  const amd: HarvestSuggestion = {
    instrumentId: "i1",
    unrealizedGross: "3360.35",
    tfRate: "0",
    unrealizedAdjusted: "3360.35",
    harvestableGross: "148.46",
    taxSaving: "37.12",
    instrument: { symbol: "AMD", name: "AMD Inc.", assetClass: "equity", market: "US" },
  };
  const msft: HarvestSuggestion = {
    instrumentId: "i2",
    unrealizedGross: "-96",
    tfRate: "0",
    unrealizedAdjusted: "-96",
    harvestableGross: "96",
    taxSaving: "25",
    instrument: { symbol: "MSFT", name: "Microsoft Corp.", assetClass: "equity", market: "US" },
  };
  const googl: HarvestSuggestion = {
    instrumentId: "i3",
    unrealizedGross: "50",
    tfRate: "0",
    unrealizedAdjusted: "50",
    harvestableGross: "50",
    taxSaving: "12",
    instrument: { symbol: "GOOGL", name: "Alphabet Inc.", assetClass: "equity", market: "US" },
  };

  it("names only the position(s) actually in the plan — not every listed suggestion (the reported bug)", () => {
    // 3 suggestions listed, but the plan only needed AMD — reproduces the live scenario
    // that prompted this fix: the old copy said "Harvest all 3" even though 2 of them
    // (MSFT, GOOGL) were never touched.
    render(
      <HarvestSummaryNote
        suggestions={[amd, msft, googl]}
        combined={{
          positionsUsed: 1,
          combinedHarvestableGross: "148.46",
          combinedTaxSaving: "37.12",
          plan: [{ instrumentId: "i1", grossTake: "148.46", adjustedTake: "148.46" }],
        }}
        money={money}
        t={t}
      />,
    );
    expect(screen.getByText(/Sell part of AMD/)).toBeInTheDocument();
    expect(screen.getByText(/Rp 148/)).toBeInTheDocument();
    expect(screen.getByText(/Rp 37/)).toBeInTheDocument();
    // The other two positions are named as untouched, not folded into the plan.
    expect(screen.getByText(/other 2 positions/)).toBeInTheDocument();
    expect(screen.queryByText(/MSFT/)).toBeNull();
    expect(screen.queryByText(/GOOGL/)).toBeNull();
    expect(screen.queryByText(/Harvest all/)).toBeNull();
  });

  it("uses the 'harvest all' phrasing when every listed suggestion is actually in the plan", () => {
    render(
      <HarvestSummaryNote
        suggestions={[amd, msft]}
        combined={{
          positionsUsed: 2,
          combinedHarvestableGross: "280",
          combinedTaxSaving: "74",
          plan: [
            { instrumentId: "i1", grossTake: "184", adjustedTake: "184" },
            { instrumentId: "i2", grossTake: "96", adjustedTake: "96" },
          ],
        }}
        money={money}
        t={t}
      />,
    );
    expect(screen.getByText(/Harvest all 2 positions \(AMD, MSFT\)/)).toBeInTheDocument();
    expect(screen.getByText(/Rp 280/)).toBeInTheDocument();
    expect(screen.getByText(/Rp 74/)).toBeInTheDocument();
    expect(screen.queryByText(/Sell part of/)).toBeNull();
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
        combined={{
          positionsUsed: 0,
          combinedHarvestableGross: "0",
          combinedTaxSaving: "0",
          plan: [],
        }}
        money={money}
        t={t}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

// ---------------------------------------------------------------------------
// Indonesian final-tax components
// ---------------------------------------------------------------------------
// IdSalesTable now lives in ./disposal-table.tsx alongside its German counterpart
// DisposalTable — see disposal-table.test.tsx for both.

const incomeRow = (o: Partial<IdIncomeTax> & Pick<IdIncomeTax, "symbol" | "category">) =>
  ({
    currency: "IDR",
    rate: "0.10",
    gross: "0",
    tax: "0",
    net: "0",
    withheldAtSource: false,
    taxBasis: "estimated",
    foreignTaxWithheld: null,
    ...o,
  }) satisfies IdIncomeTax;

describe("IdIncomeTable", () => {
  it("shows each income type with its own rate and marks withheld tax", () => {
    wrapClient(
      <IdIncomeTable
        rows={[
          incomeRow({
            symbol: "BBCA",
            category: "domestic_dividend",
            gross: "420000",
            tax: "42000.00",
            net: "378000.00",
          }),
          incomeRow({
            symbol: "ORI023",
            category: "bond_interest",
            gross: "300000",
            tax: "30000.00",
            net: "270000.00",
            withheldAtSource: true,
          }),
          incomeRow({
            symbol: "interest",
            category: "deposit_interest",
            rate: "0.20",
            gross: "250000",
            tax: "40000.00",
            net: "210000.00",
            withheldAtSource: true,
            taxBasis: "recorded",
          }),
          incomeRow({
            symbol: "SBR012",
            category: "bond_interest",
            gross: "100000",
            tax: "12500.00",
            net: "87500.00",
            withheldAtSource: true,
            taxBasis: "mixed",
          }),
          incomeRow({
            symbol: "RDSAHAM",
            category: "fund_distribution",
            rate: "0",
            gross: "50000",
            tax: "0.00",
            net: "50000.00",
            taxBasis: null,
          }),
        ]}
        totalIncomeGross="1120000"
        totalIncomeTax="124500.00"
        totalIncomeNet="995500.00"
        currency={CURRENCY}
        locale={LOCALE}
        year={2026}
      />,
    );
    expect(screen.getByText("Investment income · final tax by type")).toBeInTheDocument();
    expect(screen.queryByText(/10% final$/)).toBeNull();
    expect(screen.getByText("Dividend · 10%")).toBeInTheDocument();
    expect(screen.getAllByText("Bond interest · 10%")).toHaveLength(2);
    expect(screen.getByText("Bank interest · 20%")).toBeInTheDocument();
    expect(screen.getByText("Fund distribution · 0%")).toBeInTheDocument();
    // Withheld tax doesn't read as tax still to pay; a dividend's does.
    expect(screen.getByText("withheld at source")).toBeInTheDocument();
    expect(screen.getByText("withheld (as recorded)")).toBeInTheDocument();
    // Part recorded, part at the rate: not presented as entirely recorded.
    expect(screen.getByText("withheld (partly as recorded)")).toBeInTheDocument();
    expect(screen.getByText("you pay")).toBeInTheDocument();
    expect(screen.getByText("not taxed")).toBeInTheDocument();
    expect(screen.getAllByText("IDR 124,500").length).toBeGreaterThan(0);
    // One note per category present, including the reinvestment and Rp7.5M rules.
    expect(screen.getByText(messages.Tax.id.notes.domestic_dividend)).toBeInTheDocument();
    expect(messages.Tax.id.notes.domestic_dividend).toMatch(/reinvest.*3 years/);
    expect(screen.getByText(messages.Tax.id.notes.deposit_interest)).toBeInTheDocument();
    expect(messages.Tax.id.notes.deposit_interest).toMatch(/Rp7\.5 million/);
    expect(screen.getByText(messages.Tax.id.notes.bond_interest)).toBeInTheDocument();
    expect(screen.getByText(messages.Tax.id.notes.fund_distribution)).toBeInTheDocument();
  });

  it("only lists the notes of the categories present", () => {
    wrapClient(
      <IdIncomeTable
        rows={[incomeRow({ symbol: "BBCA", category: "domestic_dividend", gross: "100" })]}
        totalIncomeGross="100"
        totalIncomeTax="10"
        totalIncomeNet="90"
        currency={CURRENCY}
        locale={LOCALE}
        year={2026}
      />,
    );
    expect(screen.getByText(messages.Tax.id.notes.domestic_dividend)).toBeInTheDocument();
    expect(screen.queryByText(messages.Tax.id.notes.deposit_interest)).toBeNull();
  });

  it("renders the empty state when there's no investment income (ID)", () => {
    wrapClient(
      <IdIncomeTable
        rows={[]}
        totalIncomeGross="0"
        totalIncomeTax="0"
        totalIncomeNet="0"
        currency={CURRENCY}
        locale={LOCALE}
        year={2026}
      />,
    );
    expect(screen.getByText(/No Indonesian investment income/)).toBeInTheDocument();
  });
});

describe("IdForeignIncomeTable", () => {
  it("lists foreign income with the foreign tax withheld, outside the estimate", () => {
    wrapClient(
      <IdForeignIncomeTable
        rows={[
          incomeRow({
            symbol: "AAPL",
            category: "foreign",
            rate: null,
            gross: "1840000",
            tax: null,
            net: null,
            taxBasis: null,
            foreignTaxWithheld: "240000",
          }),
        ]}
        foreignIncomeGross="1840000"
        foreignTaxWithheld="240000"
        currency={CURRENCY}
        locale={LOCALE}
      />,
    );
    expect(screen.getByText("Foreign income · not in the estimate")).toBeInTheDocument();
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getAllByText("IDR 1,840,000").length).toBe(2);
    expect(screen.getAllByText("IDR 240,000").length).toBe(2);
    expect(screen.getByText(/marginal rate \(5–35%\).*credit for foreign tax/)).toBeInTheDocument();
  });

  it("renders nothing without foreign income", () => {
    const { container } = wrapClient(
      <IdForeignIncomeTable
        rows={[]}
        foreignIncomeGross="0"
        foreignTaxWithheld="0"
        currency={CURRENCY}
        locale={LOCALE}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("IdByYearTable", () => {
  it("renders every year's Est. tax column, not just the current year", () => {
    wrapClient(
      <IdByYearTable
        rows={[
          {
            year: 2026,
            realized: "324000",
            income: "1284000",
            foreignIncome: "0",
            tax: "128724.00",
          },
          {
            year: 2025,
            realized: "1940000",
            income: "2110000",
            foreignIncome: "555000",
            tax: "212940.00",
          },
        ]}
        currency={CURRENCY}
        locale={LOCALE}
      />,
    );
    const years = screen.getAllByText(/^(2026|2025)$/).map((el) => el.textContent);
    expect(years).toEqual(["2026", "2025"]);
    expect(screen.getByText("IDR 128,724")).toBeInTheDocument();
    expect(screen.getByText("IDR 212,940")).toBeInTheDocument();
    // Foreign income has its own column and is not part of Est. tax.
    expect(screen.getByText("Foreign income")).toBeInTheDocument();
    expect(screen.getByText("IDR 555,000")).toBeInTheDocument();
  });

  it("renders nothing when there are no years", () => {
    const { container } = wrapClient(
      <IdByYearTable rows={[]} currency={CURRENCY} locale={LOCALE} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

// ---------------------------------------------------------------------------
// Cash income (no paying instrument) — a readable label, never the type key
// ---------------------------------------------------------------------------

describe("cash income labels", () => {
  const cashRow = (currency: string, o: Partial<IdIncomeTax> = {}) =>
    incomeRow({
      // What the API sent before it labelled cash rows: the bare type key.
      symbol: "interest",
      cashSource: { type: "interest", currency },
      ...o,
    } as Partial<IdIncomeTax> & Pick<IdIncomeTax, "symbol" | "category">);

  it("labels foreign cash interest by type and its own currency", () => {
    wrapClient(
      <IdForeignIncomeTable
        rows={[
          cashRow("EUR", {
            category: "foreign",
            rate: null,
            gross: "676237",
            tax: null,
            net: null,
            taxBasis: null,
            foreignTaxWithheld: "0",
          }),
          cashRow("USD", {
            category: "foreign",
            rate: null,
            gross: "1000",
            tax: null,
            net: null,
            taxBasis: null,
            foreignTaxWithheld: "0",
          }),
        ]}
        foreignIncomeGross="677237"
        foreignTaxWithheld="0"
        currency={CURRENCY}
        locale={LOCALE}
      />,
    );
    expect(screen.getByText("Cash interest · EUR")).toBeInTheDocument();
    expect(screen.getByText("Cash interest · USD")).toBeInTheDocument();
    expect(screen.queryByText("interest")).toBeNull();
  });

  it("labels IDR cash interest in the domestic table, in Indonesian too", () => {
    const rows = [
      cashRow("IDR", {
        category: "deposit_interest",
        rate: "0.20",
        gross: "250000",
        tax: "50000.00",
        net: "200000.00",
        withheldAtSource: true,
      }),
    ];
    const table = (
      <IdIncomeTable
        rows={rows}
        totalIncomeGross="250000"
        totalIncomeTax="50000"
        totalIncomeNet="200000"
        currency={CURRENCY}
        locale={LOCALE}
        year={2026}
      />
    );
    const { unmount } = wrapClient(table);
    expect(screen.getByText("Cash interest · IDR")).toBeInTheDocument();
    expect(screen.queryByText("interest")).toBeNull();
    unmount();
    render(
      <NextIntlClientProvider locale="id" messages={idMessages}>
        {table}
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Bunga tunai · IDR")).toBeInTheDocument();
  });

  it("labels German-table cash income that has no description", () => {
    wrapClient(
      <DividendsTable
        rows={[
          {
            symbol: "interest",
            cashType: "interest",
            // Stored lower-case: the label still reads "EUR", as the ID tables do.
            currency: "eur",
            gross: "12",
            tax: "3",
            net: "9",
          },
        ]}
        totalsByCurrency={[{ currency: "eur", gross: "12", tax: "3", net: "9" }]}
        locale="en"
        year={2026}
      />,
    );
    expect(screen.getByText("Cash interest · EUR")).toBeInTheDocument();
    expect(screen.queryByText("interest")).toBeNull();
  });
});

describe("IdIncomeTable totals row", () => {
  it("keeps the pinned first column one column wide (no colSpan on Total)", () => {
    const { container } = wrapClient(
      <IdIncomeTable
        rows={[incomeRow({ symbol: "BBCA", category: "domestic_dividend", gross: "100" })]}
        totalIncomeGross="100"
        totalIncomeTax="10"
        totalIncomeNet="90"
        currency={CURRENCY}
        locale={LOCALE}
        year={2026}
      />,
    );
    const cells = container.querySelectorAll("tfoot td");
    expect(cells).toHaveLength(5);
    expect(cells[0]).toHaveTextContent("Total");
    expect(cells[0]!.getAttribute("colspan")).toBeNull();
  });
});
