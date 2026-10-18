import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { BenchmarkCard } from "../src/components/insights/benchmark-card";
import type { BenchmarkSymbolEntry, InsightsBenchmark } from "@portfolio/api-client";
import messages from "../messages/en.json";

const refresh = vi.fn();
const putPreferences = vi.fn();

vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/api", () => ({
  useApiClient: () => ({ putPreferences, lookupInstruments: vi.fn(async () => []) }),
}));

function renderCard(
  benchmark: InsightsBenchmark | null,
  symbols: BenchmarkSymbolEntry[] = [{ symbol: "^GSPC", displayName: "S&P 500", displayOrder: 0 }],
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <BenchmarkCard benchmark={benchmark} symbols={symbols} locale="en" />
    </NextIntlClientProvider>,
  );
}

describe("BenchmarkCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a friendly benchmark name and a single-signed percentage (regression: no doubled '+')", () => {
    renderCard({
      symbol: "^GSPC",
      activeReturn: "0.032",
      trackingError: "0.021",
      correlation: "0.85",
    });

    expect(screen.getByText("vs S&P 500")).toBeInTheDocument();
    expect(screen.getByText("+3.20%")).toBeInTheDocument();
    expect(screen.queryByText("++3.20%")).not.toBeInTheDocument();
    expect(screen.getByText(/2\.10%/)).toBeInTheDocument();
    expect(screen.queryByText(/210\.0/)).not.toBeInTheDocument();
  });

  it("shows tracking error unsigned — it is a standard deviation, not a gain", () => {
    renderCard({
      symbol: "^GSPC",
      activeReturn: "-0.5798",
      trackingError: "0.1128",
      correlation: "0.71",
    });
    expect(screen.getByText("11.28%")).toBeInTheDocument();
    expect(screen.queryByText("+11.28%")).not.toBeInTheDocument();
  });

  it("names the active return's period and basis when the window start is known", () => {
    renderCard({
      symbol: "^GSPC",
      activeReturn: "-0.5798",
      trackingError: "0.1128",
      correlation: "0.71",
      since: "2021-01-04",
    });
    expect(screen.getByText("Active return · cumulative since Jan 2021")).toBeInTheDocument();
  });

  it("shows a dash when tracking error could not be measured", () => {
    renderCard({ symbol: "^GSPC", activeReturn: "0.01", trackingError: null, correlation: "0.5" });
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows a dash, not NaN, when an older API omits tracking error", () => {
    renderCard({
      symbol: "^GSPC",
      activeReturn: "0.01",
      correlation: "0.5",
    } as unknown as InsightsBenchmark);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it("shows a measured zero tracking error as 0.00%, not as unmeasurable", () => {
    renderCard({ symbol: "^GSPC", activeReturn: "0.01", trackingError: "0", correlation: "1" });
    expect(screen.getByText("0.00%")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("keeps the plain label for a response without a window start", () => {
    renderCard({
      symbol: "^GSPC",
      activeReturn: "0.01",
      trackingError: "0.02",
      correlation: "0.5",
    });
    expect(screen.getByText("Active return")).toBeInTheDocument();
  });

  it("falls back to the raw ticker for an unrecognized benchmark symbol", () => {
    renderCard({
      symbol: "^WEIRD123",
      activeReturn: "-0.05",
      trackingError: "0.01",
      correlation: "0.5",
    });

    expect(screen.getByText("vs ^WEIRD123")).toBeInTheDocument();
    expect(screen.getByText("-5.00%")).toBeInTheDocument();
  });

  it("shows a placeholder when no benchmark is configured", () => {
    renderCard(null, []);

    const els = screen.getAllByText("Set benchmark");
    expect(els.length).toBeGreaterThanOrEqual(1);
    expect(els[0]).toBeInTheDocument();
  });

  it("shows an edit button when a benchmark is configured", () => {
    renderCard({
      symbol: "^GSPC",
      activeReturn: "0.01",
      trackingError: "0.02",
      correlation: "0.9",
    });

    expect(screen.getByRole("button", { name: /Edit/i })).toBeInTheDocument();
  });

  it("opens a dialog when the edit button is clicked", async () => {
    renderCard({
      symbol: "^GSPC",
      activeReturn: "0.01",
      trackingError: "0.02",
      correlation: "0.9",
    });
    fireEvent.click(screen.getByRole("button", { name: /Edit/i }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText("Search benchmark...")).toBeInTheDocument();
  });

  it("saves the new benchmark list as an array via putPreferences when a suggested benchmark is added", async () => {
    putPreferences.mockResolvedValue({
      benchmarkSymbols: [
        { symbol: "^GDAXI", displayName: "DAX", displayOrder: 0 },
        { symbol: "^GSPC", displayName: "S&P 500", displayOrder: 1 },
      ],
      riskFreeRate: null,
      retirementAge: null,
    });
    renderCard({
      symbol: "^GSPC",
      activeReturn: "0.01",
      trackingError: "0.02",
      correlation: "0.9",
    });
    fireEvent.click(screen.getByRole("button", { name: /Edit/i }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("DAX"));
    fireEvent.click(screen.getByRole("button", { name: /Save/i }));

    await waitFor(() => {
      expect(putPreferences).toHaveBeenCalledWith({
        benchmarkSymbols: [
          { symbol: "^GSPC", displayName: "S&P 500", displayOrder: 0 },
          { symbol: "^GDAXI", displayName: "DAX", displayOrder: 1 },
        ],
      });
    });
  });

  it("allows removing a benchmark from the list", async () => {
    putPreferences.mockResolvedValue({
      benchmarkSymbols: [],
      riskFreeRate: null,
      retirementAge: null,
    });
    renderCard({
      symbol: "^GSPC",
      activeReturn: "0.01",
      trackingError: "0.02",
      correlation: "0.9",
    });
    fireEvent.click(screen.getByRole("button", { name: /Edit/i }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    // The dialog lists the current symbols as removable chips.
    const removeButtons = screen.getAllByRole("button", { name: /Remove/i });
    fireEvent.click(removeButtons[0]);

    // After removing the only entry, the list-area "no benchmarks" placeholder
    // appears (the S&P 500 text still shows in the suggested-chips row below,
    // so we assert on the placeholder text instead of the chip itself).
    await waitFor(() => {
      expect(screen.getByText(/Add at least one benchmark/i)).toBeInTheDocument();
    });
  });
});
