import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import { UserRound, Briefcase } from "lucide-react";

let mockPathname = "/settings";

vi.mock("@/i18n/navigation", () => ({
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
  usePathname: () => mockPathname,
}));

vi.mock("@/components/scope-link", () => ({
  ScopeLink: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { SettingsShell, type ShellNavItem } from "../src/components/settings-shell";
import { SectionHeader } from "../src/components/section-header";
import { tint } from "../src/lib/tint";

const NAV_ITEMS: ShellNavItem[] = [
  {
    key: "account",
    href: "/settings/account",
    icon: <UserRound />,
    title: "Account",
    subtitle: "Currency, language & appearance",
    ...tint("primary"),
  },
  {
    key: "portfolios",
    href: "/settings/portfolios",
    icon: <Briefcase />,
    title: "Portfolios & holders",
    subtitle: "2 portfolios · 1 holder",
    ...tint("violet"),
  },
];

describe("SettingsShell", () => {
  beforeEach(() => {
    mockPathname = "/settings";
  });

  it("renders every nav item as a rail link with the right href", () => {
    render(
      <SettingsShell title="Settings" navItems={NAV_ITEMS} indexHref="/settings">
        <div>content</div>
      </SettingsShell>,
    );
    const links = screen.getAllByRole("link");
    const hrefs = links.map((l) => l.getAttribute("href"));
    expect(hrefs).toContain("/settings/account");
    expect(hrefs).toContain("/settings/portfolios");
  });

  it("shows the mobile landing menu (grouped nav rows) at the exact index route", () => {
    mockPathname = "/settings";
    render(
      <SettingsShell title="Settings" navItems={NAV_ITEMS} indexHref="/settings">
        <div>account content</div>
      </SettingsShell>,
    );
    // Landing rows render each item's title + subtitle.
    expect(screen.getAllByText("Account").length).toBeGreaterThan(0);
    expect(screen.getByText("2 portfolios · 1 holder")).toBeInTheDocument();
  });

  it("renders children (not the landing menu content) on a sub-route", () => {
    mockPathname = "/settings/portfolios";
    render(
      <SettingsShell title="Settings" navItems={NAV_ITEMS} indexHref="/settings">
        <div>portfolios content</div>
      </SettingsShell>,
    );
    expect(screen.getByText("portfolios content")).toBeInTheDocument();
    // The landing-only subtitle row shouldn't be rendered on a sub-route.
    expect(screen.queryByText("2 portfolios · 1 holder")).not.toBeInTheDocument();
  });

  it("renders railTop/railBottom/landingTop slots", () => {
    render(
      <SettingsShell
        title="Settings"
        navItems={NAV_ITEMS}
        indexHref="/settings"
        railTop={<div>rail-top-slot</div>}
        railBottom={<div>rail-bottom-slot</div>}
        landingTop={<div>landing-top-slot</div>}
      >
        <div>content</div>
      </SettingsShell>,
    );
    expect(screen.getByText("rail-top-slot")).toBeInTheDocument();
    expect(screen.getByText("rail-bottom-slot")).toBeInTheDocument();
    expect(screen.getByText("landing-top-slot")).toBeInTheDocument();
  });

  it("always renders rail links inside a <nav> card wrapper", () => {
    render(
      <SettingsShell title="Settings" navItems={NAV_ITEMS} indexHref="/settings">
        <div>content</div>
      </SettingsShell>,
    );
    const nav = screen.getAllByRole("link")[0]!.closest("nav");
    expect(nav).toHaveClass("bg-card");
  });

  describe("heading outline", () => {
    const renderShell = () =>
      render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <SettingsShell title="Settings" navItems={NAV_ITEMS} indexHref="/settings">
            <SectionHeader title="Account" backHref="/settings" />
          </SettingsShell>
        </NextIntlClientProvider>,
      );

    it("has exactly one h1 at the index — the shell's; the section title is an h2", () => {
      mockPathname = "/settings";
      renderShell();
      const h1s = screen.getAllByRole("heading", { level: 1, hidden: true });
      expect(h1s.map((h) => h.textContent)).toEqual(["Settings"]);
      expect(screen.getByRole("heading", { level: 2, hidden: true, name: "Account" })).toBeTruthy();
    });

    it("has exactly one h1 on a sub-route — the section header's", () => {
      mockPathname = "/settings/account";
      renderShell();
      const h1s = screen.getAllByRole("heading", { level: 1, hidden: true });
      expect(h1s.map((h) => h.textContent)).toEqual(["Account"]);
    });
  });
});
