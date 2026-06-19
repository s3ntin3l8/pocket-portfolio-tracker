import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { forwardRef } from "react";
import type { ImportRecord } from "@portfolio/api-client";
import messages from "../messages/en.json";

vi.mock("@/lib/api", () => ({
  useApiClient: () => ({
    discardImport: vi.fn(),
    deleteImport: vi.fn(),
    clearImport: vi.fn(),
  }),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: forwardRef<HTMLAnchorElement, React.ComponentPropsWithoutRef<"a">>(
    function Link({ children, ...props }, ref) {
      return (
        <a ref={ref} {...props}>
          {children}
        </a>
      );
    },
  ),
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { RecentImportsSection } from "../src/components/recent-imports-section";

function record(over: Partial<ImportRecord>): ImportRecord {
  return {
    id: "imp1",
    portfolioId: "p1",
    parser: "csv",
    status: "confirmed",
    count: 2,
    createdAt: "2026-06-01T10:00:00.000Z",
    ...over,
  } as ImportRecord;
}

function renderSection(items: ImportRecord[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <RecentImportsSection items={items} />
    </NextIntlClientProvider>,
  );
}

describe("RecentImportsSection", () => {
  it("collapses a confirmed/discarded-only audit trail and expands on toggle", () => {
    renderSection([record({ status: "confirmed" })]);

    const toggle = screen.getByRole("button", { expanded: false });
    // Header shows the title and the item count.
    expect(toggle).toHaveTextContent(messages.ImportHistory.title);
    expect(toggle).toHaveTextContent("(1)");

    // Collapsed: the history table (and its Undo action) isn't rendered yet.
    expect(
      screen.queryByRole("button", { name: messages.ImportHistory.undo }),
    ).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(screen.getByRole("button", { expanded: true })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: messages.ImportHistory.undo }),
    ).toBeInTheDocument();
  });

  it("auto-expands when a pending draft needs review", () => {
    renderSection([record({ id: "draft1", status: "draft" })]);

    expect(screen.getByRole("button", { expanded: true })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: messages.ImportHistory.review }),
    ).toHaveAttribute("href", "/transactions/import/draft1");
  });
});
