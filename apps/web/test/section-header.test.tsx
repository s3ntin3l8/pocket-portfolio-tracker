import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    className,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className} {...props}>
      {children}
    </a>
  ),
}));

import { SectionHeader } from "../src/components/section-header";

describe("SectionHeader", () => {
  it("renders the title and a back-link to the given href", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SectionHeader title="Investing" backHref="/settings" />
      </NextIntlClientProvider>,
    );
    expect(screen.getAllByText("Investing").length).toBe(1);
    expect(screen.getByRole("heading", { level: 1, name: "Investing" })).toBeInTheDocument();
    const backLink = screen.getByLabelText("Back");
    expect(backLink).toHaveAttribute("href", "/settings");
  });
});
