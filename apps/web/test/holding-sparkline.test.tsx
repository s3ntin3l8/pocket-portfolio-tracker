import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { HoldingSparkline } from "../src/components/holding-sparkline";

function points(container: HTMLElement): string[] {
  const pl = container.querySelector("polyline");
  return (pl?.getAttribute("points") ?? "").trim().split(/\s+/).filter(Boolean);
}

describe("HoldingSparkline", () => {
  it("renders one polyline point per value", () => {
    const { container } = render(<HoldingSparkline values={[1, 2, 3, 4]} />);
    expect(points(container)).toHaveLength(4);
  });

  it("renders nothing for fewer than two points", () => {
    const { container } = render(<HoldingSparkline values={[5]} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("colors an upward series green and a downward series red (by first→last)", () => {
    const up = render(<HoldingSparkline values={[1, 5]} />);
    expect(up.container.querySelector("svg")?.getAttribute("class")).toContain("text-success");
    const down = render(<HoldingSparkline values={[5, 1]} />);
    expect(down.container.querySelector("svg")?.getAttribute("class")).toContain(
      "text-destructive",
    );
  });

  it("draws a flat midline (no NaN) when all values are equal", () => {
    const { container } = render(<HoldingSparkline values={[3, 3, 3]} />);
    const pts = points(container);
    expect(pts.join(" ")).not.toContain("NaN");
    const ys = pts.map((p) => Number(p.split(",")[1]));
    expect(new Set(ys)).toEqual(new Set([13])); // H/2 with H=26
  });
});
