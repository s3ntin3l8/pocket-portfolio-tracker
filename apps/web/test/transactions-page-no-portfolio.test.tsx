import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import messages from "../messages/en.json";

vi.mock("next-intl/server", () => ({
  setRequestLocale: vi.fn(),
  getTranslations: async (ns: string) => {
    const bag = (messages as unknown as Record<string, Record<string, string>>)[ns] ?? {};
    return (key: string) => bag[key] ?? key;
  },
}));

vi.mock("@/lib/server-api", () => ({
  getSelectedPortfolioId: async () => null,
  loadImports: async () => [],
  loadPortfolioList: async () => [],
  loadNetworthTransactionsPaginated: async () => ({
    status: "ok",
    rows: [],
    total: 0,
    summary: null,
    years: [],
  }),
  loadTransactionsPaginated: async () => ({ status: "ok", rows: [], total: 0 }),
  loadAnomalies: async () => [],
  loadNetworthAnomalies: async () => [],
  loadMe: async () => ({ isAdmin: false, displayCurrency: "IDR" }),
}));

// Client components are out of scope here — stub them with identifiable markers.
vi.mock("@/components/add-transaction-menu", () => ({
  AddTransactionMenu: () => <div data-testid="add-menu" />,
}));
vi.mock("@/components/portfolio-form-dialog", () => ({
  PortfolioFormDialog: ({ trigger }: { trigger: React.ReactNode }) => (
    <div data-testid="create-portfolio">{trigger}</div>
  ),
}));
vi.mock("@/components/transactions-table", () => ({ TransactionsTable: () => null }));
vi.mock("@/components/export-csv-button", () => ({ ExportCsvButton: () => null }));
vi.mock("@/components/export-documents-button", () => ({ ExportDocumentsButton: () => null }));
vi.mock("@/components/recent-imports-section", () => ({ RecentImportsSection: () => null }));
vi.mock("@/components/fx-missing-banner", () => ({ FxMissingBanner: () => null }));
vi.mock("@/components/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

import TransactionsPage from "../src/app/[locale]/(app)/transactions/page";

describe("/transactions with zero portfolios (audit E9)", () => {
  it("offers to create a portfolio instead of an Add form with no target", async () => {
    const ui = await TransactionsPage({ params: Promise.resolve({ locale: "en" }) });
    render(ui);
    expect(screen.getByText(messages.Empty.noPortfolioTitle)).toBeInTheDocument();
    expect(screen.getByTestId("create-portfolio")).toBeInTheDocument();
    expect(screen.queryByTestId("add-menu")).not.toBeInTheDocument();
    expect(screen.queryByText(messages.Empty.noTransactionsTitle)).not.toBeInTheDocument();
  });
});
