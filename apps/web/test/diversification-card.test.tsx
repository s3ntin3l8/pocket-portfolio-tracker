import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AllocationBreakdown, AllocationSlice } from "@portfolio/api-client";
import { DiversificationCard } from "../src/components/insights/diversification-card";
import messages from "../messages/en.json";
import idMessages from "../messages/id.json";

const slice = (key: string, value: string): AllocationSlice =>
  ({ key, value, pct: 0 }) as AllocationSlice;

function allocation(
  byRegion: AllocationSlice[],
  byCurrency: AllocationSlice[] = [slice("USD", "100")],
): AllocationBreakdown {
  return {
    byAssetClass: [],
    byCurrency,
    byRegion,
    byCountry: [],
    bySector: [],
    byIndustry: [],
    topHoldings: [],
    concentration: { hhi: 0, top1Pct: 0, top5Pct: 0, label: "diversified" },
  };
}

function renderCard(a: AllocationBreakdown, locale: "en" | "id" = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? messages : idMessages}>
      <DiversificationCard allocation={a} classCount={2} />
    </NextIntlClientProvider>,
  );
}

// The caption counts non-zero `allocation.byRegion` slices — merged regions, not markets
// or exchanges — so it must say "regions" (#1028).
describe("DiversificationCard", () => {
  it("captions two non-zero regions as '2 regions'", () => {
    renderCard(
      allocation(
        [slice("North America", "60"), slice("Europe", "40"), slice("Asia", "0")],
        [slice("USD", "60"), slice("EUR", "40")],
      ),
    );
    expect(screen.getByText("2 regions · 2 currencies")).toBeInTheDocument();
  });

  it("captions a single region in the singular", () => {
    renderCard(allocation([slice("North America", "100")]));
    expect(screen.getByText("1 region · 1 currency")).toBeInTheDocument();
  });

  it("captions regions in Indonesian", () => {
    renderCard(allocation([slice("North America", "60"), slice("Europe", "40")]), "id");
    expect(screen.getByText("2 wilayah · 1 mata uang")).toBeInTheDocument();
  });
});
