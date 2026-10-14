import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "../src/components/app-shell";
import { PageHeaderSetter } from "../src/components/page-header";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/portfolio-switcher", () => ({ PortfolioSwitcher: () => null }));
vi.mock("@/components/add-transaction-menu", () => ({ AddTransactionMenu: () => null }));
vi.mock("@/components/global-search", () => ({ GlobalSearch: () => null }));
vi.mock("@/components/install-prompt", () => ({ InstallPrompt: () => null }));
vi.mock("@/components/brand", () => ({ Brand: () => null }));
vi.mock("@/components/bottom-nav", () => ({ BottomNav: () => null }));
vi.mock("@/components/sign-out-button", () => ({ SignOutButton: () => null }));
vi.mock("@/components/app-version", () => ({ AppVersion: () => null }));
// The assistant provider fetches status through the api client; this test is about layout only.
vi.mock("@/components/assistant/assistant-provider", () => ({
  AssistantProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/assistant/assistant-button", () => ({ AssistantButton: () => null }));
vi.mock("@/components/nav-progress", () => ({
  NavProgressProvider: ({ children }: { children: React.ReactNode }) => children,
  LinkPendingSignal: () => null,
}));
vi.mock("@/components/full-screen-overlay", () => ({
  FullScreenOverlayProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/route-transition", () => ({
  RouteTransition: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/pull-to-refresh", () => ({
  PullToRefresh: ({ children }: { children: React.ReactNode }) => children,
}));

describe("AppShell page header wiring", () => {
  it("shows a page setter title in the desktop topbar", async () => {
    render(
      <AppShell>
        <PageHeaderSetter title="Income report" backHref="/reports" />
      </AppShell>,
    );

    // The topbar title is a plain paragraph, not a heading (the page owns the one <h1>).
    expect(await screen.findByText("Income report")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Income report" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "back" })).toHaveAttribute("href", "/reports");
  });

  it("renders exactly one h1 when the page supplies its own", async () => {
    const { container } = render(
      <AppShell>
        <PageHeaderSetter title="Income report" backHref="/reports" />
        <h1>Income report</h1>
      </AppShell>,
    );
    await screen.findByText("Income report", { selector: "p" });
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });

  it("renders a skip link targeting the main landmark and labels the sidebar nav", () => {
    const { container } = render(
      <AppShell>
        <div />
      </AppShell>,
    );
    const skip = screen.getByRole("link", { name: "skipToContent" });
    expect(skip).toHaveAttribute("href", "#main");
    expect(container.querySelector("main#main")).not.toBeNull();
    expect(screen.getByRole("navigation", { name: "primaryNav" })).toBeInTheDocument();
  });

  it("gives the Activity badge accessible text", () => {
    render(
      <AppShell anomalyCount={4}>
        <div />
      </AppShell>,
    );
    expect(screen.getByText(/needsReview/)).toBeInTheDocument();
  });

  it("tones the sidebar all-time % by sign", () => {
    const { rerender } = render(
      <AppShell
        netWorthSummary={{ valueFormatted: "€1", allTimePctFormatted: "-5.00%", allTimePct: -0.05 }}
      >
        <div />
      </AppShell>,
    );
    expect(screen.getByText(/-5\.00%/).className).toContain("text-destructive");
    rerender(
      <AppShell
        netWorthSummary={{ valueFormatted: "€1", allTimePctFormatted: "+5.00%", allTimePct: 0.05 }}
      >
        <div />
      </AppShell>,
    );
    expect(screen.getByText(/\+5\.00%/).className).toContain("text-success");
  });

  it("renders the Activity anomaly badge in the sidebar when given a non-zero count", () => {
    render(
      <AppShell anomalyCount={4}>
        <div />
      </AppShell>,
    );
    expect(screen.getByText("4")).toBeInTheDocument();
  });
});
