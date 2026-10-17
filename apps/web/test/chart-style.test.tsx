import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  CHART_AXIS_TICK,
  CHART_BAR_CURSOR,
  CHART_CURSOR,
  CHART_GRID,
  CHART_SERIES_DASH,
} from "../src/lib/chart-style";
import { ChartTooltipPanel } from "../src/components/ui/chart-tooltip-panel";

describe("chart style constants", () => {
  it("uses theme tokens only, never hex", () => {
    const all = JSON.stringify([CHART_AXIS_TICK, CHART_BAR_CURSOR, CHART_CURSOR, CHART_GRID]);
    expect(all).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(all).toContain("var(--color-");
  });

  it("draws horizontal-only dashed gridlines and one series dash", () => {
    expect(CHART_GRID.vertical).toBe(false);
    expect(CHART_GRID.strokeDasharray).toBe("3 3");
    expect(CHART_SERIES_DASH).toBe("4 3");
    expect(CHART_AXIS_TICK.fontSize).toBe(11);
  });
});

describe("ChartTooltipPanel", () => {
  it("renders a bordered card-surface panel with a title and rows", () => {
    const { container } = render(
      <ChartTooltipPanel
        title="Jan 2026"
        rows={[
          { label: "Portfolio", value: "1,000", dot: "var(--color-primary)" },
          { label: "Benchmark", value: "900" },
        ]}
      />,
    );
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.className).toContain("bg-card");
    expect(panel.className).toContain("border-border");
    expect(panel.className).toContain("rounded-md");
    expect(panel.getAttribute("style")).toBeNull();
    expect(screen.getByText("Jan 2026")).toBeInTheDocument();
    expect(screen.getByText("1,000").className).toContain("tabular");
    // Only the row with a dot renders a swatch, coloured via its inline style.
    expect(container.querySelectorAll("span.size-2")).toHaveLength(1);
  });

  it("renders nothing without rows", () => {
    const { container } = render(<ChartTooltipPanel rows={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
