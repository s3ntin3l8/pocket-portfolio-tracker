import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageRail, PageWithRail } from "../src/components/page-with-rail";

describe("PageWithRail", () => {
  it("lays out main then rail, with the rail ordered last beside the content", () => {
    render(
      <PageWithRail data-testid="grid">
        <div>main</div>
        <PageRail data-testid="rail">rail</PageRail>
      </PageWithRail>,
    );
    const grid = screen.getByTestId("grid");
    expect(grid.className).toContain("@xl:grid-cols-[minmax(0,1fr)_320px]");
    expect(grid.children[0]).toHaveTextContent("main");
    expect(grid.children[1]).toBe(screen.getByTestId("rail"));
    expect(screen.getByTestId("rail").className).toContain("@xl:order-last");
    expect(screen.getByTestId("rail").className).toContain("top-[calc(var(--topbar-h)+0.5rem)]");
  });

  it("puts the rail after the main content on mobile by default", () => {
    render(<PageRail data-testid="rail" />);
    expect(screen.getByTestId("rail").className).not.toContain("order-first");
  });

  it("lets a page opt the rail first on mobile only", () => {
    render(<PageRail data-testid="rail" railFirstOnMobile />);
    const cls = screen.getByTestId("rail").className;
    expect(cls).toContain("order-first");
    expect(cls).toContain("@xl:order-last");
  });

  it("uses the 300px rail and wider gap for the narrow size", () => {
    render(<PageWithRail size="narrow" data-testid="grid" />);
    const cls = screen.getByTestId("grid").className;
    expect(cls).toContain("@xl:grid-cols-[minmax(0,1fr)_300px]");
    expect(cls).toContain("gap-6");
  });

  it("only Insights asks for a rail-first mobile order", () => {
    // Comments are stripped so a note mentioning the class cannot trip the scan.
    const read = (p: string) =>
      readFileSync(resolve(__dirname, "..", p), "utf8")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
    const page = (name: string) => `src/app/[locale]/(app)/${name}/page.tsx`;
    expect(read(page("insights"))).toContain("railFirstOnMobile");
    const pagesAndRails = [
      ...["income", "tax", "savings", "trades", "holdings"].map(page),
      "src/components/holdings/holdings-sidebar.tsx",
    ];
    for (const f of pagesAndRails) {
      expect(read(f), f).not.toContain("railFirstOnMobile");
      expect(read(f), f).not.toContain("order-first");
    }
  });
});
