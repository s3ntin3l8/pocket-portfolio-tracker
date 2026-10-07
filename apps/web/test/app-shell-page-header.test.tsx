import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "../src/components/app-shell";
import { PageHeaderSetter } from "../src/components/page-header";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/portfolio-switcher", () => ({ PortfolioSwitcher: () => null }));
vi.mock("@/components/add-transaction-menu", () => ({ AddTransactionMenu: () => null }));
vi.mock("@/components/global-search", () => ({ GlobalSearch: () => null }));
vi.mock("@/components/install-prompt", () => ({ InstallPrompt: () => null }));
vi.mock("@/components/brand", () => ({ Brand: () => null }));
vi.mock("@/components/bottom-nav", () => ({ BottomNav: () => null }));
vi.mock("@/components/sign-out-button", () => ({ SignOutButton: () => null }));
vi.mock("@/components/app-version", () => ({ AppVersion: () => null }));
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

    expect(await screen.findByRole("heading", { name: "Income report" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/reports");
  });
});
