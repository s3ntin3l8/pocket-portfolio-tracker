import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

let mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => mockSearchParams }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ScopeLink } from "../src/components/scope-link";

describe("ScopeLink", () => {
  it("carries the URL's scope onto the target", () => {
    mockSearchParams = new URLSearchParams("scope=h:h1&range=1m");
    render(<ScopeLink href="/reports">Reports</ScopeLink>);
    // Only the scope travels — range/period are per-page view state.
    expect(screen.getByRole("link", { name: "Reports" })).toHaveAttribute(
      "href",
      "/reports?scope=h%3Ah1",
    );
  });

  it("is a plain link when the URL has no scope", () => {
    mockSearchParams = new URLSearchParams("range=1m");
    render(<ScopeLink href="/reports">Reports</ScopeLink>);
    expect(screen.getByRole("link", { name: "Reports" })).toHaveAttribute("href", "/reports");
  });
});
