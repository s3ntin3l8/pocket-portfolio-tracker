import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import {
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
    expect(h1.className).toContain("md:hidden");
  });

  it("merges an optional className without leaving a trailing space", () => {
    render(<PageTitle className="custom-class">Holdings</PageTitle>);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.className).toBe("text-2xl font-bold md:hidden custom-class");
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
