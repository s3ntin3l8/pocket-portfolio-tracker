import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import idMessages from "../messages/id.json";
import { COMMAND_PAGES, MAIN_NAV, navActiveKey } from "../src/components/nav-items";
import { PageHeaderProvider, usePageHeader } from "../src/components/page-header";

/*
 * One name per concept (audit R4-G1/R4-G2): a route is called the same thing in the nav,
 * in the command palette, on the page itself and on the report card that links to it.
 * Every assertion reads the real catalogue values — a rename that misses one of the two
 * catalogues (or a page that drifts from its palette entry) fails here.
 */

type Catalogue = Record<string, Record<string, string>>;

const catalogues: Record<"en" | "id", Catalogue> = {
  en: messages as unknown as Catalogue,
  id: idMessages as unknown as Catalogue,
};

/** The catalogue namespace whose `title` names the page a palette entry opens. */
const PAGE_TITLE_NAMESPACE: Record<string, string> = {
  "/holdings": "Holdings",
  "/transactions": "Transactions",
  "/reports": "Reports",
  "/insights": "Insights",
  "/income": "Income",
  "/tax": "Tax",
  "/trades": "Trades",
  "/savings": "Savings",
  "/portfolios": "Portfolios",
  "/settings": "Settings",
  "/admin": "Admin",
};

/** The route each of the five tabs opens — its label must match that page's title. */
const TAB_ROUTE: Record<string, string> = {
  holdings: "/holdings",
  activity: "/transactions",
  reports: "/reports",
  insights: "/insights",
  settings: "/settings",
};

/**
 * The report cards and the catalogue namespace of the page each one links to.
 *
 * The card is a THIRD surface for the same name (nav, page, card), so the card's title
 * has to be the page's title — in both catalogues. The namespace is the page's own, not
 * the card's: looking the card up in the wrong namespace is what made this guard assert
 * nothing at all.
 */
const REPORT_CARD_PAGE: Record<string, string> = {
  income: "Income",
  trades: "Trades",
  savings: "Savings",
  tax: "Tax",
  gold: "GoldReport",
  documents: "TaxReports",
};

function navLabel(catalogue: Catalogue, key: string): string {
  return catalogue.Nav[key];
}

function pageTitle(catalogue: Catalogue, namespace: string): string {
  return catalogue[namespace]?.title ?? "";
}

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe("one name per concept", () => {
  for (const locale of ["en", "id"] as const) {
    const catalogue = catalogues[locale];

    it(`gives every command-palette entry the name of the page it opens (${locale})`, () => {
      for (const page of COMMAND_PAGES) {
        const namespace = PAGE_TITLE_NAMESPACE[page.href];
        expect(namespace, `no title namespace mapped for ${page.href}`).toBeTruthy();
        expect(navLabel(catalogue, page.labelKey)).toBe(pageTitle(catalogue, namespace));
      }
    });

    it(`gives every main tab the name of the page it opens (${locale})`, () => {
      for (const tab of MAIN_NAV) {
        const route = TAB_ROUTE[tab.key];
        expect(route, `no route mapped for the ${tab.key} tab`).toBeTruthy();
        expect(navLabel(catalogue, tab.key)).toBe(
          pageTitle(catalogue, PAGE_TITLE_NAMESPACE[route]),
        );
      }
    });
  }

  it("names the /settings route 'Settings' in the nav, the palette and on the page", () => {
    for (const locale of ["en", "id"] as const) {
      const catalogue = catalogues[locale];
      const paletteEntry = COMMAND_PAGES.find((p) => p.href === "/settings");
      expect(paletteEntry?.labelKey).toBe("settings");
      expect(navLabel(catalogue, paletteEntry!.labelKey)).toBe(pageTitle(catalogue, "Settings"));
    }
  });

  it("names the /trades route 'Realized P&L' in the palette and on the page", () => {
    for (const locale of ["en", "id"] as const) {
      const catalogue = catalogues[locale];
      const paletteEntry = COMMAND_PAGES.find((p) => p.href === "/trades");
      expect(paletteEntry?.labelKey).toBe("trades");
      expect(navLabel(catalogue, paletteEntry!.labelKey)).toBe(pageTitle(catalogue, "Trades"));
    }
  });

  it("drops the old 'Profile' name for the settings tab", () => {
    for (const locale of ["en", "id"] as const) {
      expect(catalogues[locale].Nav.profile).toBeUndefined();
    }
  });
});

describe("navActiveKey", () => {
  it("highlights the settings tab on /settings and /portfolios", () => {
    expect(navActiveKey("/settings")).toBe("settings");
    expect(navActiveKey("/portfolios")).toBe("settings");
  });

  it("uses the same key for the /settings tab in the main nav", () => {
    const settingsTab = MAIN_NAV.find((n) => n.href === "/settings");
    expect(settingsTab?.key).toBe(navActiveKey("/settings"));
    expect(settingsTab?.key).toBe(navActiveKey("/portfolios"));
  });

  it("keeps the other tabs on their own key", () => {
    expect(navActiveKey("/holdings")).toBe("holdings");
    expect(navActiveKey("/transactions")).toBe("activity");
    expect(navActiveKey("/reports")).toBe("reports");
    expect(navActiveKey("/insights")).toBe("insights");
  });
});

describe("message catalogues", () => {
  const enKeys = new Set(flatten(messages));
  const idKeys = new Set(flatten(idMessages));

  it("keeps the two catalogues in parity", () => {
    expect([...enKeys].filter((k) => !idKeys.has(k)).sort()).toEqual([]);
    expect([...idKeys].filter((k) => !enKeys.has(k)).sort()).toEqual([]);
  });

  it("drops the retired Profile key from both catalogues", () => {
    expect(enKeys.has("Nav.profile")).toBe(false);
    expect(idKeys.has("Nav.profile")).toBe(false);
  });

  it("keeps the reports hub free of a scope claim of its own", () => {
    // The hub's cards follow the SELECTED scope — every loader in `reports-data.ts`
    // resolves it — so a fixed scope line on the page would be false for every scoped
    // page. The shell's `PortfolioSwitcher` is the scope control here.
    expect(enKeys.has("Reports.scopeAll")).toBe(false);
    expect(idKeys.has("Reports.scopeAll")).toBe(false);
  });

  it("names the report cards like the pages they link to", () => {
    // The report card is a THIRD surface for the same concept (nav, page, card). Leaving
    // it outside the guard is how a second name comes back — the Indonesian card title
    // drifted to "Laba/Rugi Terealisasi" while the page and the nav said "P&L Terwujud".
    for (const locale of ["en", "id"] as const) {
      const catalogue = catalogues[locale];
      // The Reports namespace holds a title of its own and one object per card.
      const reports = catalogue.Reports as unknown as Record<string, unknown>;

      // Every card that carries a title is guarded — a card added without a mapping
      // would otherwise be silently outside the guard.
      const titledCards = Object.keys(reports).filter((key) => {
        const value = reports[key];
        return (
          typeof value === "object" &&
          value !== null &&
          typeof (value as { title?: unknown }).title === "string"
        );
      });
      expect(titledCards.sort(), `${locale}: a report card without a page mapping`).toEqual(
        Object.keys(REPORT_CARD_PAGE).sort(),
      );

      for (const [card, namespace] of Object.entries(REPORT_CARD_PAGE)) {
        const cardTitle = (reports[card] as { title?: unknown } | undefined)?.title;
        expect(cardTitle, `${locale}: the ${card} card has no title`).toBeTruthy();
        expect(
          cardTitle,
          `${locale}: the ${card} card and the ${namespace} page must carry the same name`,
        ).toBe(pageTitle(catalogue, namespace));
      }
    }
  });
});

// ── The pages that carry the names ───────────────────────────────────────────────────

/** The `Referer` the instrument page sees (its back target follows it). */
const referer = vi.hoisted(() => ({ value: null as string | null }));

/** What `instrumentOnce` answers — the page branches on it (ok / not_found / error). */
const instrumentResult = vi.hoisted(() => ({
  value: { status: "not_found" } as unknown,
}));

/** The `backHref` the page handed to `InstrumentHeader` (the hero chevron). */
const headerProps = vi.hoisted(() => ({ backHref: null as string | null }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(referer.value ? { referer: referer.value } : {}),
}));

vi.mock("next-intl/server", () => ({
  setRequestLocale: vi.fn(),
  getTranslations: async (ns: string) => {
    const bag = (messages as unknown as Record<string, Record<string, string>>)[ns] ?? {};
    return (key: string) => bag[key] ?? key;
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  redirect: vi.fn(),
}));

vi.mock("@/components/instrument/instrument-data", () => ({
  instrumentOnce: async () => instrumentResult.value,
  meOnce: async () => ({ isAdmin: false }),
  startInstrumentLoads: vi.fn(),
}));
vi.mock("@/components/instrument/instrument-header", () => ({
  // Records the props the page hands it — the hero chevron's href is one of the two
  // places the back target is published.
  InstrumentHeader: (props: { backHref?: string }) => {
    headerProps.backHref = props.backHref ?? null;
    return null;
  },
}));
vi.mock("@/components/instrument/instrument-sections", () => ({
  InstrumentPriceSection: () => null,
  InstrumentLotsSection: () => null,
  InstrumentIncomeSection: () => null,
  InstrumentTransactionsSection: () => null,
  InstrumentCorporateActionsSection: () => null,
  InstrumentPositionSection: () => null,
}));
vi.mock("@/components/instrument/instrument-skeletons", () => ({
  InstrumentCardSkeleton: () => null,
  InstrumentTransactionsSkeleton: () => null,
}));
vi.mock("@/components/instrument-fundamentals-card", () => ({
  InstrumentFundamentalsCard: () => null,
}));
vi.mock("@/components/instrument-manual-price-card", () => ({
  InstrumentManualPriceCard: () => null,
}));
vi.mock("@/components/instrument-visit-tracker", () => ({
  InstrumentVisitTracker: () => null,
}));

vi.mock("@/components/reports/reports-data", () => ({ startReportsLoads: vi.fn() }));
vi.mock("@/components/reports/reports-status", () => ({ ReportsStatus: () => null }));
vi.mock("@/components/reports/report-card-skeleton", () => ({ ReportCardSkeleton: () => null }));
vi.mock("@/components/reports/reports-cards", () => ({
  IncomeCard: () => null,
  TradesCard: () => null,
  SavingsCard: () => null,
  TaxCard: () => null,
  GoldCard: () => null,
  DocumentsCard: () => null,
}));

import InstrumentPage from "../src/app/[locale]/(app)/instruments/[id]/page";
import ReportsPage from "../src/app/[locale]/(app)/reports/page";

/** Reads what the page published to the desktop topbar (the shell's back chevron). */
function TopbarBackProbe() {
  const { backHref } = usePageHeader();
  return <span data-testid="topbar-back">{backHref ?? ""}</span>;
}

describe("/reports hub", () => {
  it("states no scope of its own — its cards follow the selected scope", async () => {
    // Audit R4-G4 was filed as "the hub's cards are aggregate while its neighbours are
    // scoped". Re-reading the loaders showed the opposite: they resolve the selected
    // scope, so a scope line here would be false. The hub must not claim one.
    const ui = await ReportsPage({ params: Promise.resolve({ locale: "en" }) });
    render(ui);
    expect(screen.getByText(messages.Reports.title)).toBeInTheDocument();
    // The switcher's own label for the unscoped case must not leak onto the page.
    expect(screen.queryByText(messages.PortfolioSwitcher.all)).not.toBeInTheDocument();
  });
});

describe("/instruments/:id back target", () => {
  beforeEach(() => {
    referer.value = null;
    instrumentResult.value = { status: "not_found" };
    headerProps.backHref = null;
  });

  async function renderInstrument() {
    const ui = await InstrumentPage({
      params: Promise.resolve({ locale: "en", id: "inst-1" }),
      searchParams: Promise.resolve({}),
    });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {ui}
      </NextIntlClientProvider>,
    );
  }

  function backLinkHref(): string | null {
    return screen.getByRole("link", { name: messages.A11y.back }).getAttribute("href");
  }

  it("returns to the route the instrument was opened from", async () => {
    referer.value = "http://localhost:3005/en/trades";
    await renderInstrument();
    expect(backLinkHref()).toBe("/trades");
  });

  it("returns to the exact page the instrument was opened from", async () => {
    referer.value = "http://localhost:3005/en/settings/portfolios";
    await renderInstrument();
    expect(backLinkHref()).toBe("/settings/portfolios");
  });

  it("falls back to /holdings without a referrer", async () => {
    await renderInstrument();
    expect(backLinkHref()).toBe("/holdings");
  });

  it("falls back to /holdings for a referrer outside the app", async () => {
    referer.value = "https://example.com/some/article";
    await renderInstrument();
    expect(backLinkHref()).toBe("/holdings");
  });

  it("never links outside the app, whatever the referrer says", async () => {
    referer.value = "https://example.com/trades";
    await renderInstrument();
    const href = backLinkHref() ?? "";
    expect(href.startsWith("/")).toBe(true);
    expect(href.startsWith("//")).toBe(false);
  });

  it("publishes the referring route to the hero and the topbar when the instrument loads", async () => {
    // The success path is the one that matters: the two error branches build their own
    // `BackLink`, so only here do the page's two propagation points run.
    instrumentResult.value = {
      status: "ok",
      data: {
        instrument: { id: "inst-1", symbol: "AAPL", name: "Apple", displayName: "Apple Inc." },
        history: [],
        corporateActions: [],
      },
    };
    referer.value = "http://localhost:3005/en/trades";

    const ui = await InstrumentPage({
      params: Promise.resolve({ locale: "en", id: "inst-1" }),
      searchParams: Promise.resolve({}),
    });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PageHeaderProvider>
          <TopbarBackProbe />
          {ui}
        </PageHeaderProvider>
      </NextIntlClientProvider>,
    );

    // The hero chevron.
    expect(headerProps.backHref).toBe("/trades");
    // The desktop topbar (`PageHeaderSetter` → the shell's header).
    expect(screen.getByTestId("topbar-back").textContent).toBe("/trades");
  });
});
