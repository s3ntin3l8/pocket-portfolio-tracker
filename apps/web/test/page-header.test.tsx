import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import {
  PageHeader,
  PageHeaderProvider,
  PageHeaderSetter,
  PageTitle,
  usePageHeader,
} from "../src/components/page-header";

function HeaderProbe() {
  const { title, backHref } = usePageHeader();
  return (
    <div>
      <span data-testid="title">{title ?? ""}</span>
      <span data-testid="back">{backHref ?? ""}</span>
    </div>
  );
}

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("PageHeaderContext", () => {
  it("renders empty state when no setter is mounted", () => {
    render(
      <PageHeaderProvider>
        <HeaderProbe />
      </PageHeaderProvider>,
    );
    expect(screen.getByTestId("title")).toHaveTextContent("");
    expect(screen.getByTestId("back")).toHaveTextContent("");
  });

  it("propagates title and backHref from a mounted setter", () => {
    render(
      <PageHeaderProvider>
        <PageHeaderSetter title="Holdings" />
        <HeaderProbe />
      </PageHeaderProvider>,
    );
    expect(screen.getByTestId("title")).toHaveTextContent("Holdings");
    expect(screen.getByTestId("back")).toHaveTextContent("");
  });

  it("propagates backHref when provided", () => {
    render(
      <PageHeaderProvider>
        <PageHeaderSetter title="Account" backHref="/settings" />
        <HeaderProbe />
      </PageHeaderProvider>,
    );
    expect(screen.getByTestId("title")).toHaveTextContent("Account");
    expect(screen.getByTestId("back")).toHaveTextContent("/settings");
  });

  it("clears the title when the setter unmounts (no stale title across routes)", () => {
    function Harness({ show }: { show: boolean }) {
      return (
        <PageHeaderProvider>
          {show && <PageHeaderSetter title="Edit" backHref="/transactions" />}
          <HeaderProbe />
        </PageHeaderProvider>
      );
    }

    const { rerender } = render(<Harness show={true} />);
    expect(screen.getByTestId("title")).toHaveTextContent("Edit");

    rerender(<Harness show={false} />);
    expect(screen.getByTestId("title")).toHaveTextContent("");
    expect(screen.getByTestId("back")).toHaveTextContent("");
  });

  it("updates when the setter receives new props", () => {
    function Harness({ title }: { title: string }) {
      return (
        <PageHeaderProvider>
          <PageHeaderSetter title={title} backHref="/reports" />
          <HeaderProbe />
        </PageHeaderProvider>
      );
    }

    const { rerender } = render(<Harness title="Income" />);
    expect(screen.getByTestId("title")).toHaveTextContent("Income");

    rerender(<Harness title="Trades" />);
    expect(screen.getByTestId("title")).toHaveTextContent("Trades");
  });
});

describe("PageTitle", () => {
  it("renders an h1 with the mobile-only visibility class", () => {
    render(<PageTitle>Holdings</PageTitle>);
    const h1 = screen.getByRole("heading", { level: 1, name: "Holdings" });
    expect(h1.className).toContain("md:sr-only");
  });

  it("merges an optional className without leaving a trailing space", () => {
    render(<PageTitle className="custom-class">Holdings</PageTitle>);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.className).toBe("text-heading font-semibold md:sr-only custom-class");
  });
});

describe("usePageHeader outside a provider", () => {
  it("returns the no-op default without throwing", () => {
    function NakedProbe() {
      const { title, backHref } = usePageHeader();
      return (
        <div>
          <span data-testid="title">{title ?? "DEFAULT_TITLE"}</span>
          <span data-testid="back">{backHref ?? "DEFAULT_BACK"}</span>
        </div>
      );
    }

    render(<NakedProbe />);
    expect(screen.getByTestId("title")).toHaveTextContent("DEFAULT_TITLE");
    expect(screen.getByTestId("back")).toHaveTextContent("DEFAULT_BACK");
  });
});

// `act` is required when state updates triggered by useEffect should be observable
// synchronously (cleanup on unmount clears the provider's state).
void act;

describe("PageHeader", () => {
  const wrapIntl = (ui: React.ReactNode) => (
    <NextIntlClientProvider locale="en" messages={messages}>
      <PageHeaderProvider>{ui}</PageHeaderProvider>
    </NextIntlClientProvider>
  );

  it("renders the h1, a back link and sets the topbar title and back href", () => {
    render(
      wrapIntl(
        <>
          <PageHeader title="Investing" backHref="/settings" />
          <HeaderProbe />
        </>,
      ),
    );
    expect(screen.getByRole("heading", { level: 1, name: "Investing" })).toBeInTheDocument();
    expect(screen.getByLabelText("Back")).toHaveAttribute("href", "/settings");
    expect(screen.getByTestId("title")).toHaveTextContent("Investing");
    expect(screen.getByTestId("back")).toHaveTextContent("/settings");
  });

  it("renders no back link for a top-level page and keeps the title in the topbar", () => {
    render(
      wrapIntl(
        <>
          <PageHeader title="Holdings" />
          <HeaderProbe />
        </>,
      ),
    );
    expect(screen.queryByLabelText("Back")).not.toBeInTheDocument();
    expect(screen.getByTestId("title")).toHaveTextContent("Holdings");
  });

  it("desktopBack={false} keeps the mobile link but sets no topbar back href", () => {
    render(
      wrapIntl(
        <>
          <PageHeader title="Account" backHref="/settings" desktopBack={false} />
          <HeaderProbe />
        </>,
      ),
    );
    expect(screen.getByLabelText("Back")).toBeInTheDocument();
    expect(screen.getByTestId("back")).toHaveTextContent("");
  });

  it("renders subtitle and action, and keeps the desktop margin only when they exist", () => {
    const { container, rerender } = render(
      wrapIntl(<PageHeader title="Income" subtitle="Dividends" action={<button>Export</button>} />),
    );
    expect(screen.getByText("Dividends")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(container.querySelector("div.mb-6")).not.toBeNull();
    rerender(wrapIntl(<PageHeader title="Income" />));
    expect(container.querySelector("div.mb-6")).toBeNull();
    expect(container.querySelector("div.md\\:mb-0")).not.toBeNull();
  });

  it("shows the short title on narrow screens and the full title from sm up", () => {
    render(wrapIntl(<PageHeader title="Holdings overview" mobileTitle="Holdings" />));
    expect(screen.getByText("Holdings")).toHaveClass("sm:hidden");
    expect(screen.getByText("Holdings overview")).toHaveClass("hidden", "sm:inline");
  });
});
