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
  // BarChart stub exposes the chart's data rows as hidden data-* attributes on the
  // root so tests can assert on the period labels of each row (including the synthetic
  // forecast row's translated label) without standing up a real SVG layout.
  BarChart: ({
    children,
    data,
  }: {
    children: React.ReactNode;
    data: Array<{ period: string }>;
  }) => (
    <div
      data-testid="barchart"
      data-count={data.length}
      data-periods={data.map((d) => d.period).join("|")}
    >
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
    // The synthetic row's period label is the translated i18n key — would surface as
    // a literal "Instrument.epsCurrentQuarterLabel" string if the key were dropped
    // from a locale file.
    expect(screen.getByTestId("barchart")).toHaveAttribute(
      "data-periods",
      [...QUARTERS.map((q) => q.period), messages.Instrument.epsCurrentQuarterLabel].join("|"),
    );
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

  it("omits both the estimate row and the surprise row when no consensus existed pre-report", () => {
    // Older quarters sometimes lack a pre-report estimate entirely. Showing a "Surprise:
    // 0.00" default in that case is misleading — there's nothing to compare against, so
    // both rows are skipped. The Actual row still renders so the user sees what was
    // reported.
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
    expect(screen.queryByText(messages.Instrument.epsSurpriseLabel)).not.toBeInTheDocument();
  });

  it("renders a single dashed forecast bar when only currentQuarterEstimate is provided", () => {
    // Yahoo sometimes returns earningsChart with currentQuarterEstimate but no historical
    // quarterly[] (e.g. a recently-listed name). The card's render guard should still kick
    // in via `currentEstimate != null` and render just the synthetic forecast bar.
    wrap(<EpsActualEstimateChart data={[]} currentQuarterEstimate={1.98} />);
    expect(screen.getByTestId("barchart")).toHaveAttribute("data-count", "1");
    const cells = screen.getAllByTestId("cell");
    expect(cells).toHaveLength(1);
    const forecast = cells[0];
    expect(forecast).toHaveAttribute("data-fill", "var(--color-chart-1)");
    expect(forecast).toHaveAttribute("data-opacity", "0.12");
    expect(forecast).toHaveAttribute("data-stroke", "var(--color-chart-1)");
    expect(forecast).toHaveAttribute("data-stroke-dash", "4 3");
    // The synthetic row carries the translated period label. Locking this down means a
    // missing i18n key surfaces as a literal "Instrument.epsCurrentQuarterLabel" string
    // in the rendered DOM rather than silently rendering an untranslated fallback.
    expect(screen.getByTestId("barchart")).toHaveAttribute(
      "data-periods",
      messages.Instrument.epsCurrentQuarterLabel,
    );
  });
});
