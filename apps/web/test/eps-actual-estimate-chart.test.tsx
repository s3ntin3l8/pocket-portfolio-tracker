import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import {
  ChartTooltip,
  EpsActualEstimateChart,
  EpsActualEstimateChartLegend,
} from "../src/components/charts/eps-actual-estimate-chart";

// Light recharts stubs — recharts relies on real SVG layout for its tooltip system,
// which jsdom doesn't simulate. The stubs expose enough of the data flow that the
// tests can assert on input props (forecast-bar styling, bar count, legend wiring)
// without standing up a real ResponsiveContainer.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children, data }: { children: React.ReactNode; data: unknown[] }) => (
    <div data-testid="barchart" data-count={data.length}>
      {children}
    </div>
  ),
  Bar: ({ children, dataKey }: { children: React.ReactNode; dataKey: string }) => (
    <div data-testid={`bar-${dataKey}`}>{children}</div>
  ),
  Cell: ({
    fill,
    fillOpacity,
    stroke,
    strokeDasharray,
  }: {
    fill: string;
    fillOpacity?: number;
    stroke?: string;
    strokeDasharray?: string;
  }) => (
    <div
      data-testid="cell"
      data-fill={fill}
      data-opacity={fillOpacity}
      data-stroke={stroke}
      data-stroke-dash={strokeDasharray}
    />
  ),
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
}));

function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const QUARTERS = [
  { period: "1Q2025", actual: 1.65, estimate: 1.62 },
  { period: "2Q2025", actual: 1.57, estimate: 1.43 },
  { period: "3Q2025", actual: 1.85, estimate: 1.77 },
  { period: "4Q2025", actual: 2.84, estimate: 2.67 },
];

describe("EpsActualEstimateChartLegend", () => {
  it("labels the estimate and actual series", () => {
    wrap(<EpsActualEstimateChartLegend />);
    expect(screen.getByText(messages.Instrument.epsEstimateLabel)).toBeInTheDocument();
    expect(screen.getByText(messages.Instrument.epsActualLabel)).toBeInTheDocument();
  });
});

describe("EpsActualEstimateChart", () => {
  it("renders one bar per quarter with no synthetic forecast bar when no overlay is provided", () => {
    wrap(<EpsActualEstimateChart data={QUARTERS} currentQuarterEstimate={null} />);
    expect(screen.getByTestId("barchart")).toHaveAttribute("data-count", "4");
    expect(screen.getByTestId("bar-estimate")).toBeInTheDocument();
    expect(screen.getByTestId("bar-actual")).toBeInTheDocument();
    // No forecast cell rendered at all when there's no current-quarter overlay.
    expect(screen.queryByTestId("cell")).not.toBeInTheDocument();
  });

  it("appends a forecast-style trailing bar when currentQuarterEstimate is provided", () => {
    wrap(<EpsActualEstimateChart data={QUARTERS} currentQuarterEstimate={1.98} />);
    expect(screen.getByTestId("barchart")).toHaveAttribute("data-count", "5");
    const cells = screen.getAllByTestId("cell");
    // Two cells: the actual side of the forecast bar has actual=null so it renders no
    // cell; the estimate side renders one cell with the forecast treatment.
    expect(cells).toHaveLength(1);
    const forecast = cells[0];
    expect(forecast).toHaveAttribute("data-fill", "var(--color-chart-1)");
    expect(forecast).toHaveAttribute("data-opacity", "0.12");
    expect(forecast).toHaveAttribute("data-stroke", "var(--color-chart-1)");
    expect(forecast).toHaveAttribute("data-stroke-dash", "4 3");
  });
});

// `ChartTooltip` is unit-tested directly — recharts' `Tooltip` only invokes `content`
// at real layout time, which jsdom stubs don't simulate (same rationale as
// revenue-earnings-chart.tsx's tooltip tests).
describe("EpsActualEstimateChart ChartTooltip", () => {
  const t = (key: string) => (messages.Instrument as unknown as Record<string, string>)[key] ?? key;

  it("renders nothing when inactive or payload is empty", () => {
    const { container: inactive } = render(<ChartTooltip active={false} t={t} />);
    expect(inactive).toBeEmptyDOMElement();

    const { container: noPayload } = render(<ChartTooltip active t={t} payload={[]} />);
    expect(noPayload).toBeEmptyDOMElement();
  });

  it("renders estimate + actual + surprise rows for the hovered quarter", () => {
    render(
      <ChartTooltip
        active
        t={t}
        label="3Q2025"
        payload={[
          {
            dataKey: "estimate",
            value: 1.77,
            payload: { period: "3Q2025", actual: 1.85, estimate: 1.77 },
          },
        ]}
      />,
    );
    expect(screen.getByText("3Q2025")).toBeInTheDocument();
    expect(screen.getByText(messages.Instrument.epsEstimateLabel)).toBeInTheDocument();
    expect(screen.getByText(messages.Instrument.epsActualLabel)).toBeInTheDocument();
    expect(screen.getByText(messages.Instrument.epsSurpriseLabel)).toBeInTheDocument();
    expect(screen.getByText("1.77")).toBeInTheDocument();
    expect(screen.getByText("1.85")).toBeInTheDocument();
    // Surprise = actual − estimate = 1.85 − 1.77 = 0.08, formatted with a leading "+".
    expect(screen.getByText("+0.08")).toBeInTheDocument();
  });

  it("omits the estimate row and shows a 0 surprise when the estimate was null pre-report", () => {
    render(
      <ChartTooltip
        active
        t={t}
        label="3Q2025"
        payload={[
          {
            dataKey: "actual",
            value: 1.85,
            payload: { period: "3Q2025", actual: 1.85, estimate: null },
          },
        ]}
      />,
    );
    expect(screen.queryByText(messages.Instrument.epsEstimateLabel)).not.toBeInTheDocument();
    expect(screen.getByText(messages.Instrument.epsActualLabel)).toBeInTheDocument();
    // Surprise collapses to 0 (no consensus to compare against).
    expect(screen.getByText("+0.00")).toBeInTheDocument();
  });
});
