import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import {
  TaxHolderDetailDE,
  TaxHolderSectionId,
} from "../src/app/[locale]/(app)/tax/tax-detail-section";
import type { TaxYearDetail } from "../src/lib/server-api";
import type { TaxTranslator } from "../src/components/tax/tax-cards";

// Narrow-screen layout of the tax page (a ~414px phone): the summary tiles must not crush
// into three columns, and the wide tables must scroll inside their cards rather than widen
// a grid track past the viewport. jsdom has no layout, so these pin the classes and the
// structure that produce it.

const t: TaxTranslator = (key) => key;
const money = (n: string | number) => `IDR ${n}`;

const idDetail = {
  currency: "IDR",
  disposals: [],
  totalProceeds: "0",
  totalGain: "0",
  dividendRows: [],
  dividendTotalsByCurrency: [],
  byYear: [],
  indonesianFinalTax: {
    disposals: [],
    totalProceeds: "0",
    totalSalesTax: "0",
    income: [
      {
        symbol: "BBCA",
        currency: "IDR",
        category: "domestic_dividend",
        rate: "0.10",
        gross: "264000",
        tax: "26400.00",
        net: "237600.00",
        withheldAtSource: false,
        taxBasis: "estimated",
        foreignTaxWithheld: null,
      },
    ],
    incomeByCategory: [],
    totalIncomeGross: "264000",
    totalIncomeTax: "26400",
    totalIncomeNet: "237600",
    foreignIncomeGross: "0",
    foreignTaxWithheld: "0",
    estimatedTax: "26400",
    taxWithheldAtSource: "0",
    taxToSelfPay: "26400",
    byYear: [],
  },
} as unknown as TaxYearDetail;

function renderId() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <section>
        <TaxHolderSectionId
          detail={idDetail}
          money={money}
          currency="IDR"
          locale="en"
          year={2026}
          t={t}
        />
      </section>
    </NextIntlClientProvider>,
  );
}

const hasClass = (el: Element | null, cls: string) =>
  (el?.getAttribute("class") ?? "").split(/\s+/).includes(cls);

describe("ID tax summary tiles on a phone", () => {
  it("gives the headline its own row and pairs the other two, 3-up only with room", () => {
    renderId();
    const hero = screen.getByText("id.hero.estimatedTax").closest(".bg-card");
    const grid = hero!.parentElement!;
    expect(hasClass(grid, "grid-cols-3")).toBe(false);
    expect(hasClass(grid, "grid-cols-2")).toBe(true);
    expect(hasClass(grid, "@3xl:grid-cols-3")).toBe(true);
    expect(hasClass(hero, "col-span-2")).toBe(true);
    expect(hasClass(hero, "@3xl:col-span-1")).toBe(true);
  });
});

describe("ID tax tables on a phone", () => {
  it("doesn't put the wide tables in a grid, so they scroll inside their cards", () => {
    renderId();
    for (const title of [messages.Tax.id.sales.title, messages.Tax.id.incomeTable.title]) {
      const card = screen.getByText(title).closest(".bg-card");
      expect(card, title).not.toBeNull();
      // A grid item's min-width is its content's (the table's min-w), which widens the
      // track past the viewport; a block child is capped at the column width.
      expect(card!.parentElement!.tagName, title).toBe("SECTION");
    }
  });
});

describe("DE tax tables on a phone", () => {
  it("stacks the disposal and dividend cards as blocks, not grid items", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <section>
          <TaxHolderDetailDE
            detail={{ ...idDetail, indonesianFinalTax: undefined }}
            currency="EUR"
            locale="en"
            year={2026}
          />
        </section>
      </NextIntlClientProvider>,
    );
    for (const title of [messages.Tax.disposals.title, messages.Tax.dividendsTable.title]) {
      const card = screen.getByText(title).closest(".bg-card");
      expect(card, title).not.toBeNull();
      expect(card!.parentElement!.tagName, title).toBe("SECTION");
    }
  });
});

describe("pinned first column in a totals row", () => {
  it("matches the footer's background", () => {
    const css = readFileSync(resolve(__dirname, "../src/app/globals.css"), "utf8");
    // Just that utility's block: from its opening to the next top-level closing brace.
    const start = css.indexOf("@utility sticky-first-col");
    const rule = css.slice(start, css.indexOf("\n}\n", start) + 2);
    expect(rule).toMatch(/tfoot :is\(th, td\):first-child \{\s*background-color: var\(--card-2\)/);
  });
});

describe("DE forecast tiles on a phone", () => {
  it("doesn't put three full display-currency amounts in one phone row", () => {
    // The page is an async server component; pin its source instead of rendering it.
    const page = readFileSync(resolve(__dirname, "../src/app/[locale]/(app)/tax/page.tsx"), "utf8");
    expect(page).not.toMatch(/className="grid grid-cols-3\b/);
    expect(page).toContain(
      "grid grid-cols-1 gap-2.5 max-sm:grid-cols-2 sm:gap-4 @lg:grid-cols-2 @3xl:grid-cols-3",
    );
    // Queried on the forecast card itself, which sits beside the rail, not on <main>.
    expect(page).toContain('<CardContent className="@container space-y-4">');
  });
});
