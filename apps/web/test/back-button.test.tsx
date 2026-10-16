import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import { BACK_BUTTON_CLASS, BackIcon, BackLink } from "../src/components/back-button";

vi.mock("@/components/scope-link", () => ({
  ScopeLink: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const wrap = (ui: React.ReactElement) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );

describe("BackLink", () => {
  it("links back with the shared accessible name and the one back-button look", () => {
    wrap(<BackLink href="/reports" />);
    const link = screen.getByRole("link", { name: messages.A11y.back });
    expect(link).toHaveAttribute("href", "/reports");
    expect(link.className).toContain("size-9");
    expect(link.className).toContain("rounded-md");
    expect(link.className).toContain("md:hidden");
  });

  it("accepts a custom label", () => {
    wrap(<BackLink href="/holdings" label="Back to holdings" />);
    expect(screen.getByRole("link", { name: "Back to holdings" })).toHaveAttribute(
      "href",
      "/holdings",
    );
  });

  it("lets a caller keep it visible on desktop with md:flex", () => {
    wrap(<BackLink href="/holdings" className="md:flex" />);
    const link = screen.getByRole("link", { name: messages.A11y.back });
    expect(link.className).toContain("md:flex");
    expect(link.className).not.toContain("md:hidden");
  });
});

describe("BACK_BUTTON_CLASS", () => {
  it("pads the tap target to the 44px minimum without growing the button", () => {
    expect(BACK_BUTTON_CLASS).toContain("size-9");
    expect(BACK_BUTTON_CLASS).toContain("before:-inset-1");
  });

  it("renders a decorative icon", () => {
    const { container } = render(<BackIcon />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
