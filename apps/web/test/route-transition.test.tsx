import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRef } from "react";

let mockPathname = "/";

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => mockPathname,
}));

import { RouteTransition } from "../src/components/route-transition";

describe("RouteTransition", () => {
  beforeEach(() => {
    mockPathname = "/";
  });

  it("renders children in a wrapper without the legacy fade-in class", () => {
    const scrollContainerRef = createRef<HTMLDivElement>();
    render(
      <RouteTransition scrollContainerRef={scrollContainerRef}>
        <p>page content</p>
      </RouteTransition>,
    );

    const content = screen.getByText("page content");
    expect(content.parentElement).not.toHaveClass("animate-fade-in");
    expect(content.parentElement?.tagName).toBe("DIV");
  });

  it("resets the scroll container to the top on mount (#584)", () => {
    const scrollContainerRef = createRef<HTMLDivElement>();
    const div = document.createElement("div");
    div.scrollTo = () => {};
    const scrollToSpy = vi.spyOn(div, "scrollTo");
    scrollContainerRef.current = div;

    render(
      <RouteTransition scrollContainerRef={scrollContainerRef}>
        <p>page content</p>
      </RouteTransition>,
    );

    expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
  });

  it("resets the scroll container to the top again when the route changes (#584)", () => {
    const scrollContainerRef = createRef<HTMLDivElement>();
    const div = document.createElement("div");
    div.scrollTo = () => {};
    const scrollToSpy = vi.spyOn(div, "scrollTo");
    scrollContainerRef.current = div;

    const { rerender } = render(
      <RouteTransition scrollContainerRef={scrollContainerRef}>
        <p>holdings content</p>
      </RouteTransition>,
    );
    scrollToSpy.mockClear();

    mockPathname = "/instruments/123";
    rerender(
      <RouteTransition scrollContainerRef={scrollContainerRef}>
        <p>instrument content</p>
      </RouteTransition>,
    );

    expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
  });

  it("remounts children when navigating to a different route", () => {
    const scrollContainerRef = createRef<HTMLDivElement>();
    mockPathname = "/holdings";
    const { rerender } = render(
      <RouteTransition scrollContainerRef={scrollContainerRef}>
        <p>holdings content</p>
      </RouteTransition>,
    );
    const before = screen.getByText("holdings content").parentElement;

    mockPathname = "/instruments/123";
    rerender(
      <RouteTransition scrollContainerRef={scrollContainerRef}>
        <p>instrument content</p>
      </RouteTransition>,
    );

    expect(screen.getByText("instrument content").parentElement).not.toBe(before);
  });
});

describe("view-transition CSS", () => {
  it("disables every view-transition animation under prefers-reduced-motion", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const css = readFileSync(resolve(import.meta.dirname, "../src/app/globals.css"), "utf8");
    const block = css.match(
      /@media \(prefers-reduced-motion: reduce\) \{\s*::view-transition-old\(\*\)[\s\S]*?\n\}/,
    );
    expect(block?.[0]).toContain("animation-duration: 0s !important");
    expect(block?.[0]).toContain("::view-transition-group(*)");
  });
});
